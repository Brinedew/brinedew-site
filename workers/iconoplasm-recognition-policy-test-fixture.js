import {
  ICONOPLASM_EXTENSION_BLOCKLIST_SCHEMA_VERSION,
  iconoplasmExtensionBlocklistContentVersion,
  normalizeIconoplasmExtensionBlocklistTerms,
} from "./iconoplasm-extension-blocklist-policy.js"
import { iconoplasmPublicationAliasManifest } from "./iconoplasm-publication-aliases.js"
import { iconoplasmRecognitionPairKvKey } from "./iconoplasm-recognition-policy-reconciliation.js"

export async function seedIconoplasmTestRecognitionPair(
  entries,
  { aliasRevision = 1, blocklistRevision = 1, blocklistTerms = [] } = {},
) {
  if (!(entries instanceof Map)) {
    throw new TypeError("Iconoplasm recognition-pair test entries must be a Map")
  }
  const terms = normalizeIconoplasmExtensionBlocklistTerms(blocklistTerms)
  const [publicationAliases, blocklistVersion] = await Promise.all([
    iconoplasmPublicationAliasManifest(),
    iconoplasmExtensionBlocklistContentVersion(terms),
  ])
  const key = iconoplasmRecognitionPairKvKey(aliasRevision, blocklistRevision)
  const value = JSON.stringify({
    schema_version: 1,
    alias_revision: aliasRevision,
    blocklist_revision: blocklistRevision,
    alias_depends_on_blocklist_revision: null,
    blocklist_depends_on_alias_revision: null,
    publication_aliases: publicationAliases,
    extension_blocklist: {
      schema_version: ICONOPLASM_EXTENSION_BLOCKLIST_SCHEMA_VERSION,
      revision: blocklistRevision,
      version: blocklistVersion,
      term_count: terms.length,
      terms,
    },
  })
  const existing = entries.get(key)
  if (existing != null && String(existing) !== value) {
    throw new Error(`Recognition-pair test fixture collision at ${key}`)
  }
  entries.set(key, value)
  return { key, value }
}

export function listIconoplasmTestKv(entries, { prefix = "", limit = 1_000 } = {}) {
  if (!(entries instanceof Map)) {
    throw new TypeError("Iconoplasm KV test entries must be a Map")
  }
  const matching = [...entries.keys()]
    .filter((key) => String(key).startsWith(String(prefix || "")))
    .sort()
  return {
    keys: matching.slice(0, limit).map((name) => ({ name })),
    list_complete: matching.length <= limit,
  }
}
