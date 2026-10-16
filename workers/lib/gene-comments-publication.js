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
// Each write is one PUT and its read-back: 2 subrequests, no D1 rows written.
import {
  createPublishedCardObjectStore,
  geneCommentsObjectKey,
} from "./iconoplasm-published-card-objects.js"
import {
  externalPortraitStoragePassword,
  externalPortraitStorageUrl,
} from "./iconoplasm-portrait-storage.js"

// What a guest may see of one comment row (the rows carry user_id for the Worker's ownership
// checks; it never leaves the Worker).
export function publicGeneComment(row) {
  return {
    id: Number(row?.id || 0) || 0,
    username: String(row?.username || "") || "Anonymous",
    avatar_url: String(row?.avatar_url || ""),
    body: String(row?.body || ""),
    created_at: String(row?.created_at || ""),
    updated_at: String(row?.updated_at || ""),
  }
}

export function geneCommentsObject(symbol, rows) {
  const comments = (Array.isArray(rows) ? rows : []).map(publicGeneComment)
  return { symbol, count: comments.length, comments }
}

// Writes the object from the gene's visible comment rows, newest first, as the route reads
// them. Throws when storage is unreachable, so a caller that must not move on without it
// (erasure) can wait. A deployment with no object storage has no public copy to keep.
export async function publishGeneCommentsObject(env, symbol, rows) {
  const key = geneCommentsObjectKey(symbol)
  if (!externalPortraitStorageUrl(env, key) || !externalPortraitStoragePassword(env)) {
    return { key, skipped: "storage_unconfigured" }
  }
  const object = geneCommentsObject(key.slice("comments/v1/".length, -".json".length), rows)
  const written = await createPublishedCardObjectStore(env).writeStable(key, object)
  return { key, count: object.count, bytes: written.size }
}
