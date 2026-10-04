// B-992: the one definition of how a gene comment looks in the public #iconoplasm Discord channel.
//
// The poster (postIconoplasmGeneCommentToDiscord, in the stateful runtime) builds the message with
// `commentMirrorContent`. The account erasure (workers/iconoplasm/account-erasure/) finds the same
// message again with `commentMirrorPostPattern` and rewrites or removes it, so both must read the
// same shape: a header line naming the gene with an embed-suppressed link, a blank line, then the
// author in bold in front of the comment.
//
//   New comment on **TP53** gene: <https://iconoplasm.brinedew.bio/gene/TP53>
//
//   **author**: comment text

// Discord caps a message at 2000 characters; the header and the author take the rest.
export const COMMENT_MIRROR_BODY_LIMIT = 1500

export function commentMirrorText(body) {
  const text = String(body || "").trim()
  return text.length > COMMENT_MIRROR_BODY_LIMIT
    ? `${text.slice(0, COMMENT_MIRROR_BODY_LIMIT)}…`
    : text
}

export function commentMirrorAuthor(username) {
  return String(username || "").trim() || "Anonymous"
}

export function commentMirrorContent({ symbol, link, username, body }) {
  return (
    `New comment on **${symbol}** gene: <${link}>\n\n` +
    `**${commentMirrorAuthor(username)}**: ${commentMirrorText(body)}`
  )
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Matches the message `commentMirrorContent` made for this gene and author. Groups: the header up
 * to the opening of the author, the separator after the author, and the comment text.
 */
export function commentMirrorPostPattern({ symbol, username }) {
  return new RegExp(
    `^(New comment on \\*\\*${escapeRegExp(symbol)}\\*\\* gene: <[^>\\s]+>\\n\\n\\*\\*)` +
      `${escapeRegExp(commentMirrorAuthor(username))}(\\*\\*: )([\\s\\S]*)$`,
  )
}

/** The same message with another author in front of the unchanged comment text. */
export function commentMirrorWithAuthor(content, { symbol, username, author }) {
  const pattern = commentMirrorPostPattern({ symbol, username })
  return pattern.test(content)
    ? content.replace(
        pattern,
        (_whole, head, separator, text) => `${head}${author}${separator}${text}`,
      )
    : null
}
