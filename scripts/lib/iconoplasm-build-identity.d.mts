export interface BuildIdentity {
  schemaVersion: number
  channel: "release" | "development"
  version: string
  payloadSha256: string
}
export function createBuildIdentity(
  root: string,
  manifest: { version: string },
  release: boolean,
  buildConfiguration?: Record<string, string>,
): BuildIdentity
export function applyBuildIdentity<
  T extends { version: string; name?: string; description?: string },
>(manifest: T, identity: unknown): T
