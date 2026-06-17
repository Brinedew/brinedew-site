import { access, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const fontsDir = path.join(repoRoot, "shared", "iconoplasm-card", "fonts")
const subsetText = path.join(fontsDir, "critical-subset.txt")

const fonts = [
  "IBMPlexMono-Regular.woff2",
  "IBMPlexMono-Medium.woff2",
  "LeagueSpartan-800.woff2",
  "SpecialElite-Regular.woff2",
  "Caveat-400.woff2",
]

function outputName(name) {
  return name.replace(/\.woff2$/u, "-critical.woff2")
}

async function run(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code}`))
    })
  })
}

async function main() {
  await access(subsetText)
  await mkdir(fontsDir, { recursive: true })

  for (const font of fonts) {
    const input = path.join(fontsDir, font)
    const output = path.join(fontsDir, outputName(font))
    await access(input)
    await run("pyftsubset", [
      input,
      `--text-file=${subsetText}`,
      "--flavor=woff2",
      "--layout-features=*",
      "--desubroutinize",
      `--output-file=${output}`,
    ])
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
