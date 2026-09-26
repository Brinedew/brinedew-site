import assert from "node:assert/strict"
import test from "node:test"

import { buildCandidateGenerationPrompt } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// B-879: the owner retired the "colors" tag category because colour words pull
// image generation off course. 18,886 of 19,217 saved tag records still carry
// it (a median 9.5% of each flat tag list), so it is dropped where the prompt
// is built, from the grouping saved alongside the flat list.
const geneContext = {
  gene_symbol: "STAT5A",
  full_name: "signal transducer and activator of transcription 5A",
  manifestation: "she anchors the Control faction",
  manifestation_tags: "thick thighs, indigo, ground shatter, burgundy, static fist stance",
  manifestation_fields_json: JSON.stringify({
    body: ["thick thighs"],
    colors: ["indigo", "burgundy"],
    action: ["ground shatter"],
    pose_mood: ["static fist stance"],
  }),
}

test("a Taggerizer prompt leaves out the retired colors tags (B-879)", () => {
  const prompt = buildCandidateGenerationPrompt({ symbol: "STAT5A", geneContext })
  assert.match(prompt, /thick thighs, ground shatter, static fist stance/)
  assert.doesNotMatch(prompt, /indigo|burgundy/)
})

test("a record without grouping keeps its whole flat list (B-879)", () => {
  const prompt = buildCandidateGenerationPrompt({
    symbol: "STAT5A",
    geneContext: { ...geneContext, manifestation_fields_json: null },
  })
  assert.match(prompt, /thick thighs, indigo, ground shatter, burgundy, static fist stance/)
})
