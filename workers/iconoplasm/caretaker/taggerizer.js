// B-995: the on-site taggerizer behind the caretaker editor's two buttons,
// "Auto-extract tags from prose" and "Auto-correct prose from tags". Both return a SUGGESTION; nothing is
// saved here. The editor's own save path stores what the caretaker accepts.
//
// Engine: Cloudflare Workers AI through the `AI` binding.
//   Model: "@cf/google/gemma-4-26b-a4b-it" (Gemma 4 26B). Id, chat-completions
//   output shape, `response_format` support and 256k context are from
//   https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/
//   (read 2026-10-04).
//   Cost: https://developers.cloudflare.com/workers-ai/platform/pricing/ lists
//   9,091 Neurons per million input tokens and 27,273 per million output tokens
//   for it, and the free plan includes 10,000 Neurons a day. A call of about
//   3,000 input and 400 output tokens is about 38 Neurons, so roughly 260 calls
//   a day are free. TAGGERIZER_DAILY_LIMIT keeps one caretaker from spending it all.
//
// The Tags shape and the tagging prompt mirror the workstation tagger in the
// Iconoplasm repo, src/manifestation.py:
//   DEFAULT_TAG_CATEGORIES (line ~2176)       -> TAG_CATEGORIES (shared/iconoplasm-tag-categories.js)
//   DEFAULT_TAGGER_SYSTEM_PROMPT (line ~6053) -> TAGS_FROM_PROSE_SYSTEM_PROMPT
//   parse_tagger_fields (line ~6104)          -> parseTaggerReply
// Differences on purpose: this module also clamps each category to 6 tags (the
// workstation only asks for it in the prompt), turns tags into snake_case, and
// folds the retired pose_mood/colors categories exactly as the editor does.

import { secondsUntilCloudflareDailyReset } from "../../lib/cloudflare-availability.js"
import {
  ICONOPLASM_MANIFESTATION_PROSE_MAX_CODE_POINTS,
  normalizeManifestationProse,
} from "../../lib/iconoplasm-manifestation-prose.js"
import { TAG_CATEGORIES, upcastTagFields } from "../../../shared/iconoplasm-tag-categories.js"

export const TAGGERIZER_MODEL = "@cf/google/gemma-4-26b-a4b-it"
export const TAGGERIZER_DAILY_LIMIT = 30
export const MAX_TAGS_PER_CATEGORY = 6
const MAX_TAG_LENGTH = 64

export const TAGGERIZER_DIRECTIONS = Object.freeze(["tags_from_prose", "prose_from_tags"])

export const TAGGERIZER_MESSAGES = Object.freeze({
  disabled: "The Tags helper is switched off for now. You can still edit Tags and prose by hand.",
  allowanceUsed: "The free AI allowance for today is used up; try again after 00:00 UTC.",
  caretakerLimit: `You have used your ${TAGGERIZER_DAILY_LIMIT} Tags-helper suggestions for today; they reset at 00:00 UTC.`,
  badReply: "The AI gave an answer the editor could not use. Nothing was changed; try again.",
  unavailable: "The AI is not answering right now. Nothing was changed; try again in a minute.",
  needProse: "Write some prose first, then ask for Tags.",
  needTags: "Add at least one tag first, then ask for prose.",
  proseTooLong: `The prose is over ${ICONOPLASM_MANIFESTATION_PROSE_MAX_CODE_POINTS.toLocaleString("en-US")} characters; shorten it first.`,
})

export const TAGS_FROM_PROSE_SYSTEM_PROMPT = [
  "You are a strict tag extractor.",
  "Convert the character description into danbooru-style tags.",
  "Return ONLY a JSON object with category arrays.",
  "",
  "Rules:",
  "- Lowercase snake_case tags only.",
  "- Each tag must be self-describing on its own.",
  `- Max ${MAX_TAGS_PER_CATEGORY} tags per category.`,
  "- Keep categories present in this schema; leave unknown categories out.",
  "- No markdown, no prose, no explanations.",
  "",
  "Categories: " + TAG_CATEGORIES.join(", ") + ".",
  "",
  "Example input:",
  "A massive, scarred veteran with a shaved head and a thick beard streaked with grey. " +
    "Square jaw, crooked nose broken more than once. Built like a bull -- barrel chest, " +
    "tree-trunk arms, hands like shovels. Wears battered plate armor over chain mail, " +
    "heavy boots, and a wolf-pelt cloak. Carries a two-handed war hammer and a hunting " +
    "knife on his belt. Stone-faced with a permanent scowl, stands with feet wide apart " +
    "like he is daring something to try.",
  "",
  "Example output:",
  '{"archetype":["veteran_mercenary","heavy_fighter"],' +
    '"body":["massive_build","barrel_chest","scarred_torso","tree_trunk_arms"],' +
    '"face":["square_jaw","crooked_nose","permanent_scowl","thick_grey_beard"],' +
    '"hair":["shaved_head"],' +
    '"outfit":["battered_plate_armor","chain_mail","heavy_boots","wolf_pelt_cloak"],' +
    '"accessories":["hunting_knife"],' +
    '"fantastical":[],' +
    '"action":["war_hammer_wielder","two_handed_stance"],' +
    '"pose":["wide_stance"],' +
    '"signature":["broken_nose_veteran"],' +
    '"background":[],"composition":[]}',
].join("\n")

export const PROSE_FROM_TAGS_SYSTEM_PROMPT = [
  "You edit a caretaker's written description of a character so that it agrees with the character's Tags.",
  "The Tags were corrected by the caretaker and are the source of truth.",
  "",
  "Rules:",
  "- Rewrite the given prose as little as possible: change only what contradicts the Tags, and add short mentions of Tags the prose never covers.",
  "- Keep the caretaker's voice, tense, sentence style and paragraph breaks.",
  "- Do not invent features that neither the prose nor the Tags state.",
  "- If the prose is empty, write one short descriptive paragraph from the Tags alone.",
  `- Never exceed ${ICONOPLASM_MANIFESTATION_PROSE_MAX_CODE_POINTS} characters.`,
  '- Return ONLY a JSON object of the form {"prose": "<the full rewritten prose>"}. No markdown, no commentary.',
].join("\n")

// Fields the editor already holds, as the lines the model reads: "face: square_jaw, crooked_nose".
function tagLines(fields) {
  return Object.entries(fields)
    .filter(([, tags]) => Array.isArray(tags) && tags.length)
    .map(([category, tags]) => `${category}: ${tags.join(", ")}`)
    .join("\n")
}

function tagsSchema() {
  return {
    type: "object",
    properties: Object.fromEntries(
      TAG_CATEGORIES.map((category) => [category, { type: "array", items: { type: "string" } }]),
    ),
    required: [...TAG_CATEGORIES],
  }
}

export class TaggerizerError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message)
    this.code = code
    this.status = status
    this.extra = extra
  }
}

function normalizeTag(raw) {
  return String(raw)
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[,\n\r]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
}

// The workstation's rules (a JSON object of category arrays of nonempty strings),
// then the website's: snake_case, at most 6 per category, no repeats in a category.
function cleanFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) {
    throw new TaggerizerError("TAGGERIZER_BAD_REPLY", TAGGERIZER_MESSAGES.badReply, 502)
  }
  const cleaned = Object.create(null)
  for (const [category, tags] of Object.entries(value)) {
    if (!category.trim() || !Array.isArray(tags)) {
      throw new TaggerizerError("TAGGERIZER_BAD_REPLY", TAGGERIZER_MESSAGES.badReply, 502)
    }
    const list = []
    for (const tag of tags) {
      if (typeof tag !== "string" || !tag.trim()) {
        throw new TaggerizerError("TAGGERIZER_BAD_REPLY", TAGGERIZER_MESSAGES.badReply, 502)
      }
      const normalized = normalizeTag(tag)
      if (normalized && normalized.length <= MAX_TAG_LENGTH && !list.includes(normalized)) {
        list.push(normalized)
      }
    }
    cleaned[category.trim()] = list.slice(0, MAX_TAGS_PER_CATEGORY)
  }
  return cleaned
}

function modelJson(reply) {
  const content = reply?.choices?.[0]?.message?.content ?? reply?.response ?? reply
  if (content && typeof content === "object") return content
  let raw = String(content ?? "").trim()
  const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) raw = fence[1]
  try {
    return JSON.parse(raw)
  } catch {
    throw new TaggerizerError("TAGGERIZER_BAD_REPLY", TAGGERIZER_MESSAGES.badReply, 502)
  }
}

// Output shape the editor and the existing Tags save both take:
// { tags_text: "a, b, c", fields_json: { category: [tags] } }.
export function parseTaggerReply(reply) {
  const fields = Object.assign({}, upcastTagFields(cleanFields(modelJson(reply))))
  const tags = [...new Set(Object.values(fields).flat())]
  if (!tags.length) {
    throw new TaggerizerError("TAGGERIZER_BAD_REPLY", TAGGERIZER_MESSAGES.badReply, 502)
  }
  return { tags_text: tags.join(", "), fields_json: fields }
}

export function parseProseReply(reply) {
  const value = modelJson(reply)
  try {
    return { prose: normalizeManifestationProse(value?.prose).prose }
  } catch {
    throw new TaggerizerError("TAGGERIZER_BAD_REPLY", TAGGERIZER_MESSAGES.badReply, 502)
  }
}

// What the caller sent, checked before any AI call or counter write.
export function readTaggerizerInput(body) {
  const direction = body?.direction
  if (!TAGGERIZER_DIRECTIONS.includes(direction)) {
    throw new TaggerizerError("TAGGERIZER_DIRECTION_INVALID", "Choose Tags or prose.", 400)
  }
  const prose = typeof body.prose === "string" ? body.prose.normalize("NFC") : ""
  if (Array.from(prose).length > ICONOPLASM_MANIFESTATION_PROSE_MAX_CODE_POINTS) {
    throw new TaggerizerError("TAGGERIZER_PROSE_TOO_LONG", TAGGERIZER_MESSAGES.proseTooLong, 400)
  }
  if (direction === "tags_from_prose") {
    if (!prose.trim()) {
      throw new TaggerizerError("TAGGERIZER_PROSE_REQUIRED", TAGGERIZER_MESSAGES.needProse, 400)
    }
    return { direction, prose, fields: null }
  }
  // The editor can hold string-valued or extra metadata fields; only tag lists count here.
  const source = body.tags_fields
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TaggerizerError("TAGGERIZER_TAGS_INVALID", TAGGERIZER_MESSAGES.needTags, 400)
  }
  const fields = {}
  for (const [category, value] of Object.entries(source)) {
    const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : []
    fields[category] = list.filter((tag) => typeof tag === "string" && tag.trim()).slice(0, 200)
  }
  if (!Object.values(fields).some((tags) => tags.length)) {
    throw new TaggerizerError("TAGGERIZER_TAGS_REQUIRED", TAGGERIZER_MESSAGES.needTags, 400)
  }
  return { direction, prose, fields }
}

export function taggerizerDisabled(env) {
  return String(env?.ICONOPLASM_TAGGERIZER_DISABLED || "") === "1" || !env?.AI
}

// Gemma 4 thinks before it answers unless the chat template is told not to, and the
// thinking counts against max_completion_tokens. Measured on production Workers AI,
// 2026-10-05, on SOX11's 4,000-character prose: Tags with thinking on spent all 1,200
// tokens on 4,141 characters of reasoning and returned an empty answer
// (finish_reason "length"), so every press failed with TAGGERIZER_BAD_REPLY; Prose
// did the same at 4,096 tokens after 81 s and 122 neurons. With thinking off: Tags
// 6 s, 202 tokens, 16 neurons; Prose 17 s, 815 tokens, 33 neurons, both parsed. A
// bigger budget with thinking on also parses, at 98 s and 127 neurons a call.
const NO_THINKING = Object.freeze({ enable_thinking: false })

export function taggerizerRequest({ direction, prose, fields }) {
  if (direction === "tags_from_prose") {
    return {
      messages: [
        { role: "system", content: TAGS_FROM_PROSE_SYSTEM_PROMPT },
        { role: "user", content: `Character description:\n${prose}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: tagsSchema(),
      },
      chat_template_kwargs: NO_THINKING,
      max_completion_tokens: 1200,
      temperature: 0.2,
    }
  }
  return {
    messages: [
      { role: "system", content: PROSE_FROM_TAGS_SYSTEM_PROMPT },
      { role: "user", content: `Tags:\n${tagLines(fields)}\n\nProse:\n${prose || "(empty)"}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        type: "object",
        properties: { prose: { type: "string" } },
        required: ["prose"],
      },
    },
    chat_template_kwargs: NO_THINKING,
    max_completion_tokens: 4096,
    temperature: 0.3,
  }
}

// Workers AI answers an exhausted free allowance with error 3036, HTTP 429: "You have used up
// your daily free allocation of 10,000 neurons. Please upgrade to Cloudflare's Workers Paid plan
// if you would like to continue usage." (developers.cloudflare.com/workers-ai/platform/errors/,
// read 2026-10-04).
function allowanceExhausted(error) {
  return /3036|daily free allocation|free allocation|neurons/i.test(
    String(error?.message || error || ""),
  )
}

// One call, no retry loop: a refusal or a bad reply goes straight back to the caretaker.
export async function runTaggerizer(env, input, nowMs = Date.now()) {
  let reply
  try {
    reply = await env.AI.run(TAGGERIZER_MODEL, taggerizerRequest(input))
  } catch (error) {
    if (allowanceExhausted(error)) {
      throw new TaggerizerError(
        "TAGGERIZER_ALLOWANCE_USED",
        TAGGERIZER_MESSAGES.allowanceUsed,
        503,
        {
          retryAfterSeconds: secondsUntilCloudflareDailyReset(nowMs),
        },
      )
    }
    throw new TaggerizerError("TAGGERIZER_UNAVAILABLE", TAGGERIZER_MESSAGES.unavailable, 502)
  }
  return input.direction === "tags_from_prose" ? parseTaggerReply(reply) : parseProseReply(reply)
}

// One caretaker-day counter, one D1 upsert per admitted call. Over the limit, the
// upsert evaluates json() on a bad value, which makes D1 refuse the statement
// (the idiom icono_vote_daily_budget uses in votes/vote-guards.js).
const DAILY_REFUSAL = "TAGGERIZER_DAILY_LIMIT_REACHED"

export async function admitTaggerizerCall(
  primaryDb,
  accountId,
  nowIso,
  limit = TAGGERIZER_DAILY_LIMIT,
) {
  if (!primaryDb?.prepare) {
    throw new TaggerizerError("TAGGERIZER_UNAVAILABLE", TAGGERIZER_MESSAGES.unavailable, 503)
  }
  try {
    await primaryDb
      .prepare(
        `INSERT INTO icono_taggerizer_daily_calls (day, account_id, calls)
         VALUES (?1, ?2, 1)
         ON CONFLICT(day, account_id) DO UPDATE SET calls = CASE
           WHEN icono_taggerizer_daily_calls.calls < ?3 THEN icono_taggerizer_daily_calls.calls + 1
           ELSE json('${DAILY_REFUSAL}')
         END`,
      )
      .bind(nowIso.slice(0, 10), accountId, limit)
      .run()
  } catch (error) {
    if (/malformed JSON|TAGGERIZER_DAILY_LIMIT_REACHED/i.test(String(error?.message || error))) {
      throw new TaggerizerError("TAGGERIZER_DAILY_LIMIT", TAGGERIZER_MESSAGES.caretakerLimit, 429, {
        retryAfterSeconds: secondsUntilCloudflareDailyReset(Date.parse(nowIso), 0),
      })
    }
    throw error
  }
}
