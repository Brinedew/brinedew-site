// THE ONLY PUBLISHER OF A GENE'S PUBLIC COMMENTS OBJECT: DO NOT DUPLICATE.
//
// A reader who is not signed in reads a gene's comments from the CDN at
// comments/v1/<SYMBOL>.json instead of asking the Worker. Before this, the page skipped the
// fetch for them altogether and said "No comments yet." on genes that had comments, because
// a gene page view costs no Worker request at all (measured 2026-10-17 on TP53: the only API
// call a guest's view makes is Discord's invite counts) and one per view would spend the free
// plan's 100,000 daily requests that votes and sign-ins share: a Reddit spike of 5,000 visitors
// an hour opening 3 genes each would use the day up in about 6.5 hours.
//
// The object is the answer GET /api/iconoplasm/genes/<SYMBOL>/comments gives a guest: the same
// visible comments, newest first, with no account ids and no ownership flags. Signed-in readers
// keep the Worker route, which tells them which comments are theirs to edit.
//
// It is written on every change to a gene's comments: a post, an edit or a delete (after the
// route's own response, best-effort), and an account erasure (before the rows are rewritten, so
// an erased name never outlives its rows in public). A gene nobody has commented on has no
// object, and the page reads the CDN's 404 as an empty list. Freshness is Bunny's replica lag
// plus the pull zone's 60 s edge cache time (bunny/the-only-iconoplasm-pull-zone-policy.json).
// Each write is one PUT and its read-back, plus one Discord fetch per author pictured: no D1 rows
// written.
//
// Pictures are embedded as `data:` URIs, as the GeneGuessr board does (leaderboard-publication.js):
// the rows store a `/api/avatar` path, which is a Worker request per picture, and the privacy page
// promises that only the signed-in site contacts Discord.
import {
  createPublishedCardObjectStore,
  geneCommentsObjectKey,
} from "./iconoplasm-published-card-objects.js"
import {
  externalPortraitStoragePassword,
  externalPortraitStorageUrl,
} from "./iconoplasm-portrait-storage.js"
import { discordAvatarDataUri, discordAvatarSource } from "./avatar-proxy.js"

// Authors pictured per write, newest comments first; the rest show their initial, as an account
// with no picture does. Cloudflare's own limits set it: a free-plan invocation may make 50
// subrequests, and a comment post already spends about ten on the Discord copy, the caretaker's
// message and this object's PUT and read-back with their retries. Sixteen pictures of up to 11 KB
// also keep fifty long comments under the object's 512 KiB.
export const GENE_COMMENTS_PICTURED_AUTHORS = 16

// What a guest may see of one comment row (the rows carry user_id for the Worker's ownership
// checks; it never leaves the Worker). `avatar` is the embedded picture, or "".
export function publicGeneComment(row, avatar = "") {
  return {
    id: Number(row?.id || 0) || 0,
    username: String(row?.username || "") || "Anonymous",
    avatar_url: String(avatar || ""),
    body: String(row?.body || ""),
    created_at: String(row?.created_at || ""),
    updated_at: String(row?.updated_at || ""),
  }
}

export function geneCommentsObject(symbol, rows, avatars = new Map()) {
  const comments = (Array.isArray(rows) ? rows : []).map((row) =>
    publicGeneComment(row, avatars.get(discordAvatarSource(row?.avatar_url)) || ""),
  )
  return { symbol, count: comments.length, comments }
}

// Each distinct author's picture, fetched once.
async function fetchAvatars(rows, fetchImpl) {
  const sources = []
  for (const row of rows) {
    const source = discordAvatarSource(row?.avatar_url)
    if (source && !sources.includes(source)) sources.push(source)
    if (sources.length === GENE_COMMENTS_PICTURED_AUTHORS) break
  }
  const pictures = await Promise.all(
    sources.map((source) => discordAvatarDataUri(source, fetchImpl)),
  )
  const avatars = new Map()
  sources.forEach((source, index) => pictures[index] && avatars.set(source, pictures[index]))
  return { avatars, fetches: sources.length }
}

// The pictures already in the gene's public copy, by comment id: account erasure rewrites the
// copy without spending its Discord budget on everyone else's pictures again.
async function storedAvatars(store, key, rows) {
  const stored = await store.readStable(key)
  const byId = new Map()
  if (stored) {
    const object = JSON.parse(new TextDecoder().decode(stored.bytes))
    for (const comment of object?.comments || []) {
      if (comment?.avatar_url) byId.set(Number(comment.id), comment.avatar_url)
    }
  }
  const avatars = new Map()
  for (const row of rows) {
    const source = discordAvatarSource(row?.avatar_url)
    const picture = byId.get(Number(row?.id))
    if (source && picture) avatars.set(source, picture)
  }
  return avatars
}

// Writes the object from the gene's visible comment rows, newest first, as the route reads
// them. Throws when storage is unreachable, so a caller that must not move on without it
// (erasure) can wait. A deployment with no object storage has no public copy to keep.
// `avatars: "reuse"` takes the pictures from the copy already published (one storage read)
// instead of from Discord.
export async function publishGeneCommentsObject(
  env,
  symbol,
  rows,
  { avatars: mode = "fetch", fetchImpl = (...args) => fetch(...args) } = {},
) {
  const key = geneCommentsObjectKey(symbol)
  if (!externalPortraitStorageUrl(env, key) || !externalPortraitStoragePassword(env)) {
    return { key, skipped: "storage_unconfigured" }
  }
  const list = Array.isArray(rows) ? rows : []
  const store = createPublishedCardObjectStore(env)
  const { avatars, fetches } =
    mode === "reuse"
      ? { avatars: await storedAvatars(store, key, list), fetches: 0 }
      : await fetchAvatars(list, fetchImpl)
  const object = geneCommentsObject(
    key.slice("comments/v1/".length, -".json".length),
    list,
    avatars,
  )
  const written = await store.writeStable(key, object)
  return { key, count: object.count, pictured: avatars.size, fetches, bytes: written.size }
}
