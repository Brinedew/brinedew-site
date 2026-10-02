// Keyset paging for the admin Styles scorecard (B-903).
//
// A page is a seek in an index that already exists, never a scan and never an
// OFFSET, so it reads its own rows plus one look-ahead row at any depth:
//
//   live    idx_icono_admin_vision_rollup_live_score, read forward or backward
//   vision  the primary key, read forward or backward
//
// A cursor is the sort-key values of one row. "After row X" in a mixed-direction
// index is a union of per-prefix ranges, nearest range first. Each range is its
// own query, run only while the page is not yet full, so the rows read add up
// to the page. One row-value comparison would seek only the first column and
// read every tied row before the cursor (14,992 rows for a 13-row page).

const TABLE = "icono_admin_vision_rollup"
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_CURSOR_TEXT = 1024
const MAX_VISION_ID_LENGTH = 255

// `natural` is the direction the index stores a column in. `defaultDir` is the
// displayed direction that reads the index forward.
const SORTS = Object.freeze({
  live: Object.freeze({
    defaultDir: "desc",
    columns: Object.freeze([
      Object.freeze({ name: "live_count", natural: "DESC", integer: true }),
      Object.freeze({ name: "score", natural: "DESC", integer: true }),
      Object.freeze({ name: "image_count", natural: "DESC", integer: true }),
      Object.freeze({ name: "vision_id", natural: "ASC", integer: false }),
    ]),
  }),
  vision: Object.freeze({
    defaultDir: "asc",
    columns: Object.freeze([Object.freeze({ name: "vision_id", natural: "ASC", integer: false })]),
  }),
})

function encodeCursor(values) {
  const bytes = new TextEncoder().encode(JSON.stringify(values))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

function decodeCursor(sort, text) {
  if (typeof text !== "string" || !text || text.length > MAX_CURSOR_TEXT) return null
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null
  let values
  try {
    const padded = text.replaceAll("-", "+").replaceAll("_", "/")
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
    values = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(binary, (c) => c.charCodeAt(0)),
      ),
    )
  } catch {
    return null
  }
  const { columns } = SORTS[sort]
  if (!Array.isArray(values) || values.length !== columns.length) return null
  for (let index = 0; index < columns.length; index++) {
    const value = values[index]
    if (columns[index].integer) {
      if (!Number.isSafeInteger(value)) return null
    } else if (typeof value !== "string" || !value || value.length > MAX_VISION_ID_LENGTH) {
      return null
    }
  }
  return values
}

function keyOf(sort, row) {
  return SORTS[sort].columns.map(({ name, integer }) =>
    integer ? Number(row?.[name] || 0) : String(row?.[name] || ""),
  )
}

// Reads `limit` rows of one natural scan. `forward` follows the index order and
// `cursor === null` starts at its first row; otherwise it follows the reversed
// order and starts at the last. Rows come back nearest-first.
async function scan(db, sort, { cursor, forward, limit }) {
  const { columns } = SORTS[sort]
  const flip = (direction) => (direction === "ASC" ? "DESC" : "ASC")
  const orderBy = columns
    .map(({ name, natural }) => `${name} ${forward ? natural : flip(natural)}`)
    .join(", ")
  if (!cursor) {
    const result = await db
      .prepare(`SELECT * FROM ${TABLE} ORDER BY ${orderBy} LIMIT ?`)
      .bind(limit)
      .all()
    return Array.isArray(result?.results) ? result.results : []
  }
  const rows = []
  for (let last = columns.length - 1; last >= 0 && rows.length < limit; last--) {
    const ties = columns.slice(0, last).map(({ name }) => `${name} = ?`)
    const moves = (forward ? columns[last].natural === "ASC" : columns[last].natural !== "ASC")
      ? ">"
      : "<"
    const result = await db
      .prepare(
        `SELECT * FROM ${TABLE} WHERE ${[...ties, `${columns[last].name} ${moves} ?`].join(" AND ")} ORDER BY ${orderBy} LIMIT ?`,
      )
      .bind(...cursor.slice(0, last + 1), limit - rows.length)
      .all()
    if (Array.isArray(result?.results)) rows.push(...result.results)
  }
  return rows
}

// Validates the query of one scorecard request. A parameter this module does not
// know (for example the old `scope=all`) is not read, so a stale caller gets the
// default first page.
export function parseAdminVisionScorecardQuery(searchParams) {
  const sort = searchParams.get("sort") ?? "live"
  if (!Object.hasOwn(SORTS, sort)) return { error: "Unsupported sort; use live or vision" }
  const dir = searchParams.get("dir") ?? SORTS[sort].defaultDir
  if (dir !== "asc" && dir !== "desc") return { error: "Unsupported dir; use asc or desc" }

  let limit = DEFAULT_LIMIT
  if (searchParams.has("limit")) {
    const text = searchParams.get("limit")
    if (!/^[0-9]{1,9}$/.test(text) || Number(text) < 1)
      return { error: "limit must be a whole number from 1 to " + MAX_LIMIT }
    limit = Math.min(MAX_LIMIT, Number(text))
  }

  const after = searchParams.get("after")
  const before = searchParams.get("before")
  const from = searchParams.get("from")
  if ([after, before, from].filter((value) => value !== null).length > 1)
    return { error: "Send at most one of after, before and from" }
  if (from !== null && from !== "end") return { error: "from must be end" }
  const cursorText = after ?? before
  const cursor = cursorText === null ? null : decodeCursor(sort, cursorText)
  if (cursorText !== null && !cursor) return { error: "Invalid cursor for this sort" }

  return {
    sort,
    dir,
    limit,
    cursor,
    direction: before !== null || from !== null ? "backward" : "forward",
  }
}

// One page in display order. `hasNext`/`hasPrev` are exact for the end that was
// read past (one look-ahead row) and true for the end the cursor came from.
export async function readAdminVisionScorecardPage(db, { sort, dir, limit, cursor, direction }) {
  const spec = SORTS[sort]
  const reversed = dir !== spec.defaultDir
  const displayForward = direction === "forward"
  const scanned = await scan(db, sort, {
    cursor,
    forward: displayForward ? !reversed : reversed,
    limit: limit + 1,
  })
  const more = scanned.length > limit
  const page = scanned.slice(0, limit)
  if (!displayForward) page.reverse()

  const hasNext = displayForward ? more : cursor !== null
  const hasPrev = displayForward ? cursor !== null : more
  const nextKey = page.length ? keyOf(sort, page[page.length - 1]) : cursor
  const prevKey = page.length ? keyOf(sort, page[0]) : cursor
  return {
    rows: page,
    nextCursor: hasNext && nextKey ? encodeCursor(nextKey) : null,
    prevCursor: hasPrev && prevKey ? encodeCursor(prevKey) : null,
  }
}
