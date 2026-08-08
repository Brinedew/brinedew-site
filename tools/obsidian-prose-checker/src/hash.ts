import { createHash, randomUUID } from "node:crypto"

export function hashDocument(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

export function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}
