import { access, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const fontsDir = path.join(repoRoot, "shared", "iconoplasm-card", "fonts")
const criticalUnicodeRange =
  "U+0000-024F,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD"

const fontJobs = [
  ...[
    "IBMPlexMono-Regular.woff2",
    "IBMPlexMono-Medium.woff2",
    "LeagueSpartan-800.woff2",
    "SpecialElite-Regular.woff2",
    "Caveat-400.woff2",
  ].map((name) => ({
    input: path.join(fontsDir, name),
    output: path.join(fontsDir, outputName(name)),
  })),
  {
    input: path.join(repoRoot, "quartz", "static", "fonts", "CrimsonPro-VariableFont_wght.woff2"),
    output: path.join(fontsDir, "CrimsonPro-VariableFont_wght-critical.woff2"),
  },
  {
    input: path.join(
      repoRoot,
      "quartz",
      "static",
      "fonts",
      "CrimsonPro-Italic-VariableFont_wght.woff2",
    ),
    output: path.join(fontsDir, "CrimsonPro-Italic-VariableFont_wght-critical.woff2"),
  },
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
  await mkdir(fontsDir, { recursive: true })

  for (const { input, output } of fontJobs) {
    await access(input)
    await run("pyftsubset", [
      input,
      `--unicodes=${criticalUnicodeRange}`,
      "--flavor=woff2",
      "--layout-features=*",
      "--no-hinting",
      `--output-file=${output}`,
    ])
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
