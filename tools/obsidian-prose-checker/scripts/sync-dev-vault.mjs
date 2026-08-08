import { copyFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const websiteRoot = resolve(packageRoot, "..", "..")
const vaultRoot = resolve(websiteRoot, "artifacts", "obsidian-prose-checker", "dev-vault")
const obsidianRoot = resolve(vaultRoot, ".obsidian")
const pluginRoot = resolve(obsidianRoot, "plugins", "brinedew-prose-checker")

await mkdir(pluginRoot, { recursive: true })
for (const name of [
  "main.js",
  "main.js.map",
  "harper-engine.cjs",
  "harper-engine.cjs.map",
  "manifest.json",
  "styles.css",
  "versions.json",
  "LICENSE",
  "NOTICE",
]) {
  await copyFile(resolve(packageRoot, "dist", name), resolve(pluginRoot, name))
}

await writeFile(
  resolve(obsidianRoot, "community-plugins.json"),
  `${JSON.stringify(["brinedew-prose-checker"], null, 2)}\n`,
  "utf8",
)
await writeFile(
  resolve(obsidianRoot, "app.json"),
  `${JSON.stringify({ livePreview: true, readableLineLength: true }, null, 2)}\n`,
  "utf8",
)
await writeFile(
  resolve(pluginRoot, "data.json"),
  `${JSON.stringify({ settings: { remoteConsentAccepted: true } }, null, 2)}\n`,
  "utf8",
)
await writeFile(
  resolve(vaultRoot, "Prose-checker-smoke.md"),
  `# Tumor suppressor mechanisms

A caretaker is a type of tumor-suppressor gene. Two alleles exist. One mutates. The other works. Growth stays restrained.

This page will explain why this distinction is critically important. A useful way to think about RB1 is as the cell's brake.

Genome instability affects cancer progression rather than proliferation speed.
`,
  "utf8",
)

process.stdout.write(`${vaultRoot}\n`)
