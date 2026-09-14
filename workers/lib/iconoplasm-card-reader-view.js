// ARCHITECTURE FENCE [IPD-008] + ARCHITECTURE FENCE [IPD-011]
import {
  canonicalPublishedJson,
  publishedCardObjectKey,
  publishedObjectHash,
} from "./iconoplasm-published-card-objects.js"

// IPD-008/IPD-011: an immutable view is a base manifest plus a content-addressed
// directory root. Directory pages form a copy-on-write radix tree, not a history
// chain. Updating a gene visits only its hash path; old roots remain readable.
export const GENE_DIRECTORY_LEAF_LIMIT = 32
export const GENE_DIRECTORY_DEPTH_LIMIT = 16
export const GENE_DIRECTORY_BATCH_LIMIT = 120
const HASH = /^[a-f0-9]{64}$/
const BASE = /^ccv2-([a-f0-9]{64})$/
const VIEW = /^(ccv2-[a-f0-9]{64})\.c([a-f0-9]{64})$/
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}$/
const encoder = new TextEncoder()

export function parseCardReaderView(version) {
  const match = VIEW.exec(String(version || ""))
  return match
    ? { base: match[1], hash: match[2], key: publishedCardObjectKey("indexes", match[2]) }
    : null
}

export function directoryReceipt(raw) {
  if (!raw || !HASH.test(raw.hash || "") || raw.key !== publishedCardObjectKey("indexes", raw.hash))
    throw new Error("Invalid immutable directory reference")
  return { key: raw.key, hash: raw.hash }
}

function canonicalEntry(symbol, raw) {
  if (
    !SYMBOL.test(symbol) ||
    raw?.symbol !== symbol ||
    !Number.isSafeInteger(raw.version) ||
    raw.version < 1 ||
    !HASH.test(raw.selection_key || "") ||
    !["committed", "withdrawn"].includes(raw.status)
  )
    throw new Error("Invalid committed gene directory entry")
  const entry = {
    symbol,
    version: raw.version,
    selection_key: raw.selection_key,
    status: raw.status,
  }
  for (const [name, kind] of [
    ["card", "cards"],
    ["gene", "genes"],
    ["portrait", "portraits"],
  ]) {
    const value = raw[name]
    if (!HASH.test(value?.hash || "") || value.key !== publishedCardObjectKey(kind, value.hash))
      throw new Error("Invalid gene projection identity")
    entry[name] = { key: value.key, hash: value.hash }
  }
  return entry
}

export function validateGeneDirectoryNode(value, depth) {
  if (value?.schema_version !== 1 || value.depth !== depth || depth > GENE_DIRECTORY_DEPTH_LIMIT)
    throw new Error("Invalid gene directory page")
  if (value.type === "gene-directory-leaf") {
    const entries = value.entries
    if (
      !entries ||
      Array.isArray(entries) ||
      typeof entries !== "object" ||
      Object.keys(entries).length > GENE_DIRECTORY_LEAF_LIMIT
    )
      throw new Error("Invalid gene directory leaf")
    for (const [symbol, entry] of Object.entries(entries)) canonicalEntry(symbol, entry)
  } else if (value.type === "gene-directory-branch") {
    if (
      depth >= GENE_DIRECTORY_DEPTH_LIMIT ||
      !value.children ||
      Array.isArray(value.children) ||
      typeof value.children !== "object"
    )
      throw new Error("Invalid gene directory branch")
    const names = Object.keys(value.children)
    if (!names.length || names.length > 16) throw new Error("Invalid gene directory fanout")
    for (const name of names) {
      if (!/^[a-f0-9]$/.test(name)) throw new Error("Invalid gene directory bucket")
      directoryReceipt(value.children[name])
    }
  } else throw new Error("Unknown gene directory page")
  return value
}

// read/write are the existing verified object-store methods. Limits bound one
// operation; failures preserve the old root and leave the pending batch intact.
export function createGeneDirectory({ read, write }) {
  async function hashSymbols(symbols) {
    return new Map(
      await Promise.all(
        symbols.map(async (symbol) => [symbol, await publishedObjectHash(encoder.encode(symbol))]),
      ),
    )
  }
  async function load(ref, depth, meter) {
    directoryReceipt(ref)
    if (++meter.reads > meter.limit) throw new Error("Gene directory read bound exceeded")
    const object = await read(ref.key)
    if (!object || object.hash !== ref.hash) throw new Error("Gene directory page unavailable")
    return validateGeneDirectoryNode(object.value, depth)
  }
  async function put(value, meter) {
    if (++meter.writes > meter.limit) throw new Error("Gene directory write bound exceeded")
    return directoryReceipt(await write("indexes", value))
  }
  async function update(root, entries) {
    if (!Array.isArray(entries) || entries.length > GENE_DIRECTORY_BATCH_LIMIT)
      throw new Error("Gene directory update batch exceeds bound")
    if (!entries.length) return root
    const updates = Object.fromEntries(
      entries.map((entry) => [entry.symbol, canonicalEntry(entry.symbol, entry)]),
    )
    if (Object.keys(updates).length !== entries.length)
      throw new Error("Duplicate gene directory update")
    const paths = await hashSymbols(Object.keys(updates))
    const meter = {
      reads: 0,
      writes: 0,
      limit: 1 + entries.length * 16 * (GENE_DIRECTORY_DEPTH_LIMIT + 1),
    }
    async function visit(ref, additions, depth) {
      const node = ref
        ? await load(ref, depth, meter)
        : { schema_version: 1, type: "gene-directory-leaf", depth, entries: {} }
      if (node.type === "gene-directory-leaf") {
        const next = { ...node.entries }
        for (const [symbol, entry] of Object.entries(additions)) {
          const prior = next[symbol]
          if (prior && prior.version > entry.version) continue
          if (
            prior &&
            prior.version === entry.version &&
            canonicalPublishedJson(prior) !== canonicalPublishedJson(entry)
          )
            throw new Error("Conflicting immutable gene version")
          next[symbol] = entry
        }
        if (canonicalPublishedJson(next) === canonicalPublishedJson(node.entries)) return ref
        if (Object.keys(next).length <= GENE_DIRECTORY_LEAF_LIMIT)
          return put({ ...node, entries: next }, meter)
        if (depth >= GENE_DIRECTORY_DEPTH_LIMIT)
          throw new Error("Gene directory depth bound exceeded")
        for (const symbol of Object.keys(next))
          if (!paths.has(symbol))
            paths.set(symbol, await publishedObjectHash(encoder.encode(symbol)))
        const groups = {}
        for (const [symbol, entry] of Object.entries(next))
          (groups[paths.get(symbol)[depth]] ||= {})[symbol] = entry
        const children = {}
        for (const [bucket, group] of Object.entries(groups))
          children[bucket] = await visit(null, group, depth + 1)
        return put({ schema_version: 1, type: "gene-directory-branch", depth, children }, meter)
      }
      const children = { ...node.children }
      const groups = {}
      for (const [symbol, entry] of Object.entries(additions))
        (groups[paths.get(symbol)[depth]] ||= {})[symbol] = entry
      for (const [bucket, group] of Object.entries(groups))
        children[bucket] = await visit(children[bucket] || null, group, depth + 1)
      if (canonicalPublishedJson(children) === canonicalPublishedJson(node.children)) return ref
      return put({ ...node, children }, meter)
    }
    return visit(root, updates, 0)
  }
  async function resolve(root, symbols) {
    if (!Array.isArray(symbols) || symbols.some((symbol) => !SYMBOL.test(symbol)))
      throw new Error("Invalid gene lookup")
    const result = new Map()
    if (!root || !symbols.length) return result
    const paths = await hashSymbols(symbols)
    const meter = {
      reads: 0,
      writes: 0,
      limit: 1 + symbols.length * (GENE_DIRECTORY_DEPTH_LIMIT + 1),
    }
    async function visit(ref, names, depth) {
      const node = await load(ref, depth, meter)
      if (node.type === "gene-directory-leaf") {
        for (const symbol of names)
          if (node.entries[symbol]) result.set(symbol, node.entries[symbol])
        return
      }
      const groups = {}
      for (const symbol of names) (groups[paths.get(symbol)[depth]] ||= []).push(symbol)
      await Promise.all(
        Object.entries(groups).map(
          ([bucket, names]) =>
            node.children[bucket] && visit(node.children[bucket], names, depth + 1),
        ),
      )
    }
    await visit(root, [...new Set(symbols)], 0)
    return result
  }
  async function all(root, { maxEntries = 25000 } = {}) {
    const result = new Map()
    if (!root) return result
    const meter = { reads: 0, limit: maxEntries * (GENE_DIRECTORY_DEPTH_LIMIT + 1) }
    async function visit(ref, depth) {
      const node = await load(ref, depth, meter)
      if (node.type === "gene-directory-leaf") {
        for (const [symbol, entry] of Object.entries(node.entries)) {
          if (result.has(symbol)) throw new Error("Duplicate directory membership")
          result.set(symbol, entry)
          if (result.size > maxEntries) throw new Error("Whole-view membership bound exceeded")
        }
      } else for (const child of Object.values(node.children)) await visit(child, depth + 1)
    }
    await visit(root, 0)
    return result
  }
  return { update, resolve, all }
}

export async function writeCardReaderView(objects, base, root) {
  if (!BASE.test(base)) throw new Error("Reader view requires a verified base manifest")
  directoryReceipt(root)
  const body = { schema_version: 1, type: "gene-reader-view", base, root }
  const receipt = directoryReceipt(await objects.write("indexes", body))
  return { schema_version: 2, base, view: `${base}.c${receipt.hash}`, directory: receipt }
}

export async function readCardReaderView(read, version) {
  const parsed = parseCardReaderView(version)
  if (!parsed) return null
  const object = await read(parsed.key)
  const value = object?.value
  if (
    object?.hash !== parsed.hash ||
    value?.schema_version !== 1 ||
    value.type !== "gene-reader-view" ||
    value.base !== parsed.base
  )
    throw new Error("Immutable reader view unavailable or mismatched")
  return { ...value, root: directoryReceipt(value.root) }
}
