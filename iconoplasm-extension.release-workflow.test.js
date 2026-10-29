import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import vm from "node:vm"

import JSZip from "jszip"
import { parse as parseYaml } from "yaml"

function quoteWindowsCommandArg(arg) {
  return /[\s"&|<>^]/u.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg
}

function runPnpm(args, cwd, timeout = 180_000) {
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm"
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `pnpm ${args.map(quoteWindowsCommandArg).join(" ")}`]
      : args
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    timeout,
  })
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.slice(-8_000)
  assert.equal(
    result.status,
    0,
    `pnpm ${args.join(" ")} failed${result.error ? `: ${result.error.message}` : ""}:\n${output}`,
  )
  return result
}

// B-856: `pnpm run` verifies dependencies before running, and from a worktree
// whose node_modules is a junction to the main checkout it "recreated" main's
// node_modules in place, silently re-pointing every package link (24 and 25
// Sep). The repository scripts this test needs are plain `node` commands, so
// run the exact package.json command line with node and never start a
// package manager against the repository. Installs happen only inside the
// extracted reviewer archive, a temporary directory this test owns.
const repositoryScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts
function runRepositoryScript(name, extraArgs, cwd) {
  const commandLine = repositoryScripts[name]
  assert.match(
    commandLine || "",
    /^node [^\s"'&|;]+( [^\s"'&|;]+)*$/,
    `package.json script ${name} must stay a plain node command for this test`,
  )
  const [, script, ...args] = commandLine.split(" ")
  const result = spawnSync(process.execPath, [script, ...args, ...extraArgs], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    timeout: 180_000,
  })
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.slice(-8_000)
  assert.equal(result.status, 0, `${name} failed:\n${output}`)
  return result
}

async function extractZip(zipPath, destination) {
  const zip = await JSZip.loadAsync(await readFile(zipPath))
  for (const entry of Object.values(zip.files)) {
    const outputPath = path.join(destination, entry.name)
    if (entry.dir) {
      await mkdir(outputPath, { recursive: true })
      continue
    }
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, await entry.async("nodebuffer"))
  }
}

async function zipFileContents(zipPath) {
  const zip = await JSZip.loadAsync(await readFile(zipPath))
  const files = new Map()
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) files.set(name, await entry.async("nodebuffer"))
  }
  return files
}

function firstDifference(expected, actual) {
  const limit = Math.min(expected.length, actual.length)
  let offset = 0
  while (offset < limit && expected[offset] === actual[offset]) offset += 1
  const start = Math.max(0, offset - 80)
  const end = offset + 160
  return JSON.stringify({
    offset,
    expectedLength: expected.length,
    actualLength: actual.length,
    expected: expected.subarray(start, end).toString("utf8"),
    actual: actual.subarray(start, end).toString("utf8"),
  })
}

// Store publication is a human act: both store workflows run only when someone
// dispatches them with the confirmation phrase, never on a push or a schedule.
test("store publish workflows start only by hand, with a human confirmation input", () => {
  for (const file of ["publish-iconoplasm-firefox.yml", "publish-iconoplasm-edge.yml"]) {
    const workflow = parseYaml(readFileSync(`.github/workflows/${file}`, "utf8"))
    assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"], file)
    assert.ok(workflow.on.workflow_dispatch.inputs.human_confirmation, file)
    assert.ok(workflow.on.workflow_dispatch.inputs.expected_version, file)
  }
})

test("Firefox and Edge publication need a certified PDF ownership adapter", () => {
  const certification = JSON.parse(
    readFileSync("iconoplasm-extension/pdf-ownership-certification.json", "utf8"),
  )
  assert.equal(certification.targets.chrome.store_release_ready, true)
  assert.equal(certification.targets.edge.store_release_ready, true)
  assert.equal(certification.targets.firefox.implementation_complete, true)
  assert.equal(certification.targets.firefox.store_release_ready, true)
  assert.equal(certification.renderer.pdfjs_distribution, "unmodified-pdfjs-dist")
  assert.equal(certification.renderer.filled_pill_pdf_fallback, "pill-outline")
  assert.equal(certification.targets.safari.store_release_ready, false)
})

test("release-shaped artifacts require an explicit matching publisher version", () => {
  const cases = [
    {
      args: ["./scripts/package-iconoplasm-extension.mjs", "--release"],
      expected: /Release packaging requires --expected-version=X\.Y\.Z/,
    },
    {
      args: [
        "./scripts/package-iconoplasm-extension.mjs",
        "--release",
        "--expected-version=99.0.0",
      ],
      expected: /diverges from human publisher authority/,
    },
    {
      args: ["./scripts/package-iconoplasm-firefox-source.mjs", "--release"],
      expected: /Release packaging requires --expected-version=X\.Y\.Z/,
    },
    {
      args: [
        "./scripts/package-iconoplasm-firefox-source.mjs",
        "--release",
        "--expected-version=99.0.0",
      ],
      expected: /diverges from human publisher authority/,
    },
  ]

  for (const { args, expected } of cases) {
    const result = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
    })
    assert.notEqual(result.status, 0, `${args.join(" ")} should fail closed`)
    assert.match(`${result.stdout || ""}\n${result.stderr || ""}`, expected)
  }
})

test("Firefox background-page scripts boot in dependency order without importScripts", () => {
  const listeners = {
    installed: [],
    startup: [],
    message: [],
  }
  const addListener = (collection) => (listener) => collection.push(listener)
  const sandbox = {
    URL,
    chrome: {
      runtime: {
        getManifest: () => ({ version: "test" }),
        onInstalled: { addListener: addListener(listeners.installed) },
        onStartup: { addListener: addListener(listeners.startup) },
        onMessage: { addListener: addListener(listeners.message) },
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {},
        },
        session: {
          get: async () => ({}),
          set: async () => {},
        },
      },
    },
  }
  const scripts = [
    "iconoplasm-extension/generated/catalog-contract.js",
    "iconoplasm-extension/generated/portrait-delivery-core.js",
    "iconoplasm-extension/publication-alias-overlay.js",
    "iconoplasm-extension/content-settings.js",
    "iconoplasm-extension/immutable-response-cache.js",
    "iconoplasm-extension/content-portrait-cache.js",
    "iconoplasm-extension/service-worker.js",
  ]

  vm.runInNewContext(scripts.map((path) => readFileSync(path, "utf8")).join("\n"), sandbox)

  assert.equal(sandbox.IconoplasmCatalogContract?.catalog?.schemaVersion, 5)
  assert.equal(
    typeof sandbox.IconoplasmPortraitDelivery?.normalizePortraitDeliveryPolicy,
    "function",
  )
  assert.equal(
    typeof sandbox.IconoplasmPublicationAliasOverlay?.applyPublishedAliasOverlay,
    "function",
  )
  assert.equal(listeners.installed.length, 1)
  assert.equal(listeners.startup.length, 1)
  assert.equal(listeners.message.length, 1)
})

test(
  "the extracted Firefox reviewer archive rebuilds validation without touching release artifacts",
  { timeout: 240_000 },
  async (t) => {
    const repoRoot = process.cwd()
    const version = JSON.parse(readFileSync("iconoplasm-extension/manifest.json", "utf8")).version
    const buildRoot = await mkdtemp(path.join(tmpdir(), "iconoplasm-release-test-"))
    t.after(() => rm(buildRoot, { recursive: true, force: true }))
    const sourceZip = path.join(
      buildRoot,
      "validation",
      "firefox-source",
      "iconoplasm-firefox-source-validation.zip",
    )
    const validationZip = path.join(
      buildRoot,
      "validation",
      "firefox",
      "iconoplasm-firefox-validation.zip",
    )
    const releaseZip = path.join(buildRoot, `iconoplasm-firefox-v${version}.zip`)
    const releaseSourceZip = path.join(buildRoot, `iconoplasm-firefox-source-v${version}.zip`)
    const releaseSentinel = Buffer.from("release artifact sentinel\n")
    const extractedRoot = await mkdtemp(path.join(tmpdir(), "iconoplasm-amo-source-"))
    t.after(() => rm(extractedRoot, { recursive: true, force: true }))
    await mkdir(path.dirname(releaseZip), { recursive: true })
    await writeFile(releaseZip, releaseSentinel)
    await writeFile(releaseSourceZip, releaseSentinel)

    runRepositoryScript("sync:iconoplasm-extension", [], repoRoot)
    runRepositoryScript("package:iconoplasm-firefox", [`--out-dir=${buildRoot}`], repoRoot)
    runRepositoryScript("package:iconoplasm-firefox-source", [`--out-dir=${buildRoot}`], repoRoot)
    assert.deepEqual(await readFile(releaseZip), releaseSentinel)
    assert.deepEqual(await readFile(releaseSourceZip), releaseSentinel)
    await extractZip(sourceZip, extractedRoot)

    const storeDir = runPnpm(["store", "path", "--silent"], buildRoot).stdout.trim()
    // The reviewer archive owns its frozen lock graph. Warm that exact graph
    // before proving the install/build can run offline; do not assume every
    // reviewer-only transitive tarball is also present in the repository graph.
    runPnpm(
      [
        "fetch",
        "--frozen-lockfile",
        "--config.block-exotic-subdeps=false",
        "--store-dir",
        storeDir,
      ],
      extractedRoot,
    )
    runPnpm(
      [
        "install",
        "--frozen-lockfile",
        "--offline",
        "--config.block-exotic-subdeps=false",
        "--store-dir",
        storeDir,
      ],
      extractedRoot,
    )
    runPnpm(["run", "sync:iconoplasm-extension"], extractedRoot)
    runPnpm(["run", "package:iconoplasm-firefox"], extractedRoot)

    const rebuiltZip = path.join(
      extractedRoot,
      "iconoplasm-extension",
      "dist",
      "validation",
      "firefox",
      "iconoplasm-firefox-validation.zip",
    )
    const submittedFiles = await zipFileContents(validationZip)
    const rebuiltFiles = await zipFileContents(rebuiltZip)

    assert.equal(
      [...submittedFiles.keys()].some((name) => name.startsWith("generated/pdfjs/")),
      true,
      "Firefox must ship the shared PDF.js renderer instead of deleting the capability",
    )
    for (const name of [
      "pdf-byte-store.js",
      "pdf-gecko-ownership.js",
      "pdf-gecko-redirect.js",
      "pdf-reader.mjs",
    ]) {
      assert.equal(submittedFiles.has(name), true, `Firefox package is missing ${name}`)
    }

    assert.deepEqual([...rebuiltFiles.keys()].sort(), [...submittedFiles.keys()].sort())
    for (const [name, expected] of submittedFiles) {
      const actual = rebuiltFiles.get(name)
      assert.ok(actual)
      assert.equal(
        actual.equals(expected),
        true,
        `${name} did not reproduce: ${firstDifference(expected, actual)}`,
      )
    }
  },
)

test("the AMO reviewer build pins the same direct build tools as the submission build", () => {
  const versions = (file) => {
    const manifest = JSON.parse(readFileSync(file, "utf8"))
    return { ...manifest.dependencies, ...manifest.devDependencies }
  }
  const repository = versions("package.json")
  const reviewer = versions("iconoplasm-extension/amo-source/package.json")
  for (const dependency of ["esbuild", "pdfjs-dist", "roughjs", "typescript", "wxt"]) {
    assert.equal(reviewer[dependency], repository[dependency], dependency)
  }
})
