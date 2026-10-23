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
// own warning line, leaving room for the publication's few deletes of its
// previous version: 480 deletes and a handful of lists a day. About 36 days
// clears the backlog; afterwards each run lists and finds nothing.
export const RETIRED_KV_SWEEP_DAILY_DELETES = 480

function retiredRules({ catalogArtifactVersionToken, portraitSnapshotSchemaVersion }) {
  const hydrated = "iconoplasm:hydrated-catalog-artifact:"
  const refs = "iconoplasm:published-portrait-refs:"
  return [
    { prefix: "iconoplasm:mobile-card-vm:", retired: () => true },
    { prefix: "iconoplasm:card-catalog", retired: () => true },
    {
      prefix: hydrated,
      retired: (name) => !name.startsWith(`${hydrated}${catalogArtifactVersionToken}:`),
    },
    {
      prefix: refs,
      retired: (name) => !name.startsWith(`${refs}${portraitSnapshotSchemaVersion}-`),
    },
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
      const names = page.keys
        .map((key) => key.name)
        .filter(rule.retired)
        .slice(0, limit - deleted)
      for (let i = 0; i < names.length; i += 50)
        await Promise.all(names.slice(i, i + 50).map((name) => kv.delete(name)))
      deleted += names.length
      cursor = page.list_complete ? undefined : page.cursor
    } while (cursor)
  }
  return { deleted, lists, done: true }
}
