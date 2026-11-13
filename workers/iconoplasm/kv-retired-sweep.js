// B-1147: deletes the KV keys of retired features and retired versions, a day's
// share at a time, until none are left.
//
// On 2026-10-21 the production namespace held 20,084 keys and Cloudflare
// reported 22.7 GB against the free plan's 1 GB. About 17,900 of the keys were
// written by things that no longer exist or no longer read them:
//
// - iconoplasm:mobile-card-vm:*   8,744  per-gene phone cards, retired
// - iconoplasm:card-catalog*      8,312  the sharded card catalogue, retired
// - hydrated catalogue snapshots under an older artifact version token, and
//   published portrait refs of schema v2, about 845; the current ones are
//   token CATALOG_ARTIFACT_VERSION_TOKEN and schema v3.
//
// Current versions are kept to the current and the previous one by the
// publication itself (commitPortraitReferenceSnapshot); this sweep never
// touches a key of the current token or schema, so it cannot race a
// publication that is writing its next version.
//
// Price: Cloudflare's free plan allows 1,000 KV deletes and 1,000 lists a day.
// The sweep is sheddable work (nobody waits for it). Cloudflare emails the
// owner "KV operations are nearing the daily cap" once any KV meter passes 50%,
// and at 600 a day (the sheddable tier's 60% line) the first run, 2026-10-22,
// deleted 537 and sent that warning; it would have arrived every day for a
// month, teaching the owner to ignore it. So the sweep stays under Cloudflare's
// own warning line, leaving room for the publication's deletes of its previous
// version.
//
// B-1217: 480 left too little room. The account's delete meter (Cloudflare
// GraphQL kvOperationsAdaptiveGroups, 2026-11-01..12) read 402 to 556 a day,
// almost all of it this sweep; the publication's own deletes add up to about
// 100 on a busy day. The 500 line was crossed on Nov 2 (556), Nov 6 (511) and
// Nov 12 (544), one warning email each. Reads (~3,000 of 100,000), writes
// (<160 of 1,000) and lists (<15 of 1,000) were nowhere near. At 300 the
// sweep plus a busy publication day stays near 40%. On 2026-11-13 about 7,300
// retired keys remained (5,744 phone cards, 1,556 card-catalog), so about 25
// more days; afterwards each run lists and finds nothing.
export const RETIRED_KV_SWEEP_DAILY_DELETES = 300
// Cloudflare emails the owner once a day's deletes pass this (50% of 1,000).
export const CLOUDFLARE_KV_DAILY_DELETE_WARNING = 500
// The publication's own deletes of retired versions on a busy day (B-1217).
export const OTHER_KV_DAILY_DELETES_BUSY_DAY = 100

// Largest values first. Every delete costs the same, but on 2026-10-27 the
// namespace held 22.7 GB against the free plan's 1 GB: retired hydrated
// snapshots are about 6 MB each, card-catalog keys and portrait lists about
// 2 MB, phone cards 3 KB. The first five days went to phone cards and freed
// 9 MB; in this order about 20 GB goes in the next 19 days.
function retiredRules({ catalogArtifactVersionToken, portraitSnapshotSchemaVersion }) {
  const hydrated = "iconoplasm:hydrated-catalog-artifact:"
  const refs = "iconoplasm:published-portrait-refs:"
  return [
    {
      prefix: hydrated,
      retired: (name) => !name.startsWith(`${hydrated}${catalogArtifactVersionToken}:`),
    },
    {
      prefix: refs,
      retired: (name) => !name.startsWith(`${refs}${portraitSnapshotSchemaVersion}-`),
    },
    { prefix: "iconoplasm:card-catalog", retired: () => true },
    { prefix: "iconoplasm:mobile-card-vm:", retired: () => true },
  ]
}

export async function sweepRetiredIconoplasmKvKeys(
  kv,
  versions,
  { limit = RETIRED_KV_SWEEP_DAILY_DELETES } = {},
) {
  if (!kv?.list || !kv?.delete) return { deleted: 0, lists: 0, done: false }
  let deleted = 0
  let lists = 0
  for (const rule of retiredRules(versions)) {
    let cursor
    do {
      if (deleted >= limit) return { deleted, lists, done: false }
      const page = await kv.list({ prefix: rule.prefix, cursor, limit: 1000 })
      lists += 1
      const retired = page.keys.map((key) => key.name).filter(rule.retired)
      const names = retired.slice(0, limit - deleted)
      for (let i = 0; i < names.length; i += 50)
        await Promise.all(names.slice(i, i + 50).map((name) => kv.delete(name)))
      deleted += names.length
      if (names.length < retired.length) return { deleted, lists, done: false }
      cursor = page.list_complete ? undefined : page.cursor
    } while (cursor)
  }
  return { deleted, lists, done: true }
}
