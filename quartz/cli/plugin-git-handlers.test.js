import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

import { getPluginPackageCommands } from "./plugin-git-handlers.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const cliPath = path.join(repoRoot, "quartz", "bootstrap-cli.mjs")

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  }).trim()
}

function runPluginInstall(cwd, ...args) {
  return spawnSync(process.execPath, [cliPath, "plugin", "install", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: "1" },
  })
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeWorkspaceLock(workspace, lockfile) {
  await writeJson(path.join(workspace, "package.json"), {
    name: "quartz-plugin-test-workspace",
    version: "1.0.0",
    private: true,
    type: "module",
  })
  await writeJson(path.join(workspace, "quartz.lock.json"), lockfile)
}

async function writePrebuiltPlugin(pluginDir, marker = "prebuilt") {
  await mkdir(path.join(pluginDir, "dist"), { recursive: true })
  await writeJson(path.join(pluginDir, "package.json"), {
    name: `@test/${path.basename(pluginDir)}`,
    version: "1.0.0",
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
  })
  await writeFile(path.join(pluginDir, "dist", "index.js"), `export const marker = "${marker}"\n`)
  await writeFile(
    path.join(pluginDir, "dist", "index.d.ts"),
    "declare const marker: string\nexport { marker }\n",
  )
}

async function createRemoteWithTwoCommits(root) {
  const remote = path.join(root, "remote")
  await writePrebuiltPlugin(remote, "commit-a")
  git(remote, "init", "--initial-branch=main")
  git(remote, "config", "user.name", "Quartz Test")
  git(remote, "config", "user.email", "quartz-test@example.invalid")
  git(remote, "add", ".")
  git(remote, "commit", "-m", "commit a")
  const commitA = git(remote, "rev-parse", "HEAD")

  await writeFile(path.join(remote, "dist", "index.js"), 'export const marker = "commit-b"\n')
  git(remote, "add", ".")
  git(remote, "commit", "-m", "commit b")
  const commitB = git(remote, "rev-parse", "HEAD")

  return { remote, commitA, commitB }
}

function remoteLock(remote, commit) {
  const remoteUrl = pathToFileURL(remote).href
  return {
    version: "1.0.0",
    plugins: {
      "pinned-plugin": {
        source: `git+${remoteUrl}`,
        resolved: remoteUrl,
        commit,
        installedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  }
}

test("lockfile installs and clean restores checkout the pinned remote commit", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "quartz-plugin-pin-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { remote, commitA, commitB } = await createRemoteWithTwoCommits(root)
  assert.notEqual(commitA, commitB)

  for (const [name, args] of [
    ["install", []],
    ["clean restore", ["--clean"]],
  ]) {
    const workspace = path.join(root, name.replaceAll(" ", "-"))
    await writeWorkspaceLock(workspace, remoteLock(remote, commitA))

    const result = runPluginInstall(workspace, ...args)
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, `${name} failed:\n${result.stdout}\n${result.stderr}`)

    const installed = path.join(workspace, ".quartz", "plugins", "pinned-plugin")
    assert.equal(git(installed, "rev-parse", "HEAD"), commitA)
    assert.match(await readFile(path.join(installed, "dist", "index.js"), "utf8"), /commit-a/)
    const lockAfter = JSON.parse(await readFile(path.join(workspace, "quartz.lock.json"), "utf8"))
    assert.equal(lockAfter.plugins["pinned-plugin"].commit, commitA)
  }
})

test("local lock entries resolve source.repo against the current checkout", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "quartz-plugin-local-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, ".quartz", "local-plugins", "local-plugin")
  await writePrebuiltPlugin(source, "portable-local")
  await writeWorkspaceLock(root, {
    version: "1.0.0",
    plugins: {
      "local-plugin": {
        source: {
          name: "local-plugin",
          repo: "./.quartz/local-plugins/local-plugin",
        },
        resolved: "Z:\\stale-host\\local-plugin",
        commit: "local",
        installedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  })

  const result = runPluginInstall(root)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(
    await readFile(
      path.join(root, ".quartz", "plugins", "local-plugin", "dist", "index.js"),
      "utf8",
    ),
    /portable-local/,
  )
})

test("--enabled-only leaves disabled lock entries uninstalled", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "quartz-plugin-enabled-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ["enabled-plugin", "disabled-plugin"]) {
    await writePrebuiltPlugin(path.join(root, ".quartz", "local-plugins", name), name)
  }
  await writePrebuiltPlugin(
    path.join(root, ".quartz", "plugins", "disabled-plugin"),
    "stale-disabled-plugin",
  )

  await writeFile(
    path.join(root, "quartz.config.yaml"),
    [
      "configuration: {}",
      "plugins:",
      "  - source:",
      "      name: enabled-plugin",
      "      repo: ./.quartz/local-plugins/enabled-plugin",
      "    enabled: true",
      "  - source:",
      "      name: disabled-plugin",
      "      repo: ./.quartz/local-plugins/disabled-plugin",
      "    enabled: false",
      "",
    ].join("\n"),
  )
  await writeWorkspaceLock(root, {
    version: "1.0.0",
    plugins: Object.fromEntries(
      ["enabled-plugin", "disabled-plugin"].map((name) => [
        name,
        {
          source: { name, repo: `./.quartz/local-plugins/${name}` },
          resolved: `Z:\\stale-host\\${name}`,
          commit: "local",
          installedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    ),
  })

  const result = runPluginInstall(root, "--enabled-only")
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.equal(existsSync(path.join(root, ".quartz", "plugins", "enabled-plugin")), true)
  assert.equal(existsSync(path.join(root, ".quartz", "plugins", "disabled-plugin")), true)
  const generatedIndex = await readFile(path.join(root, ".quartz", "plugins", "index.ts"), "utf8")
  assert.match(generatedIndex, /\.\/enabled-plugin/)
  assert.doesNotMatch(generatedIndex, /\.\/disabled-plugin/)
})

test("--from-config and --enabled-only can initialize an empty lockfile", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "quartz-plugin-config-init-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeJson(path.join(root, "package.json"), {
    name: "quartz-plugin-test-workspace",
    version: "1.0.0",
    private: true,
    type: "module",
  })
  await writePrebuiltPlugin(
    path.join(root, ".quartz", "local-plugins", "enabled-plugin"),
    "enabled-plugin",
  )
  await writeFile(
    path.join(root, "quartz.config.yaml"),
    [
      "configuration: {}",
      "plugins:",
      "  - source:",
      "      name: enabled-plugin",
      "      repo: ./.quartz/local-plugins/enabled-plugin",
      "    enabled: true",
      "",
    ].join("\n"),
  )

  const result = runPluginInstall(root, "--from-config", "--enabled-only")
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.equal(existsSync(path.join(root, ".quartz", "plugins", "enabled-plugin")), true)
  const lockfile = JSON.parse(await readFile(path.join(root, "quartz.lock.json"), "utf8"))
  assert.equal(lockfile.plugins["enabled-plugin"].commit, "local")
  assert.equal(
    lockfile.plugins["enabled-plugin"].resolved,
    "./.quartz/local-plugins/enabled-plugin",
  )
})

test("--enabled-only fails when an enabled plugin is absent from the lockfile", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "quartz-plugin-missing-lock-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writePrebuiltPlugin(
    path.join(root, ".quartz", "local-plugins", "enabled-plugin"),
    "enabled-plugin",
  )
  await writeFile(
    path.join(root, "quartz.config.yaml"),
    [
      "configuration: {}",
      "plugins:",
      "  - source:",
      "      name: enabled-plugin",
      "      repo: ./.quartz/local-plugins/enabled-plugin",
      "    enabled: true",
      "",
    ].join("\n"),
  )
  await writeWorkspaceLock(root, { version: "1.0.0", plugins: {} })

  const result = runPluginInstall(root, "--enabled-only")
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /enabled plugin.*missing from quartz\.lock\.json/i,
  )
  assert.equal(existsSync(path.join(root, ".quartz", "plugins", "enabled-plugin")), false)
})

test("--enabled-only fails closed for missing or malformed config and lock files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "quartz-plugin-invalid-input-"))
  t.after(() => rm(root, { recursive: true, force: true }))

  const cases = [
    {
      name: "missing-config",
      config: null,
      lock: { version: "1.0.0", plugins: {} },
      expected: /quartz\.config\.yaml.*missing/i,
    },
    {
      name: "malformed-config",
      config: "plugins: [\n",
      lock: { version: "1.0.0", plugins: {} },
      expected: /quartz\.config\.yaml.*malformed/i,
    },
    {
      name: "missing-lock",
      config: "configuration: {}\nplugins: []\n",
      lock: null,
      expected: /no quartz\.lock\.json found/i,
    },
    {
      name: "malformed-lock",
      config: "configuration: {}\nplugins: []\n",
      lock: "{not-json\n",
      expected: /quartz\.lock\.json.*malformed/i,
    },
  ]

  for (const scenario of cases) {
    const workspace = path.join(root, scenario.name)
    await writeJson(path.join(workspace, "package.json"), {
      name: `quartz-plugin-${scenario.name}`,
      version: "1.0.0",
      private: true,
      type: "module",
    })
    if (scenario.config !== null) {
      await writeFile(path.join(workspace, "quartz.config.yaml"), scenario.config)
    }
    if (scenario.lock !== null) {
      if (typeof scenario.lock === "string") {
        await writeFile(path.join(workspace, "quartz.lock.json"), scenario.lock)
      } else {
        await writeJson(path.join(workspace, "quartz.lock.json"), scenario.lock)
      }
    }

    const result = runPluginInstall(workspace, "--enabled-only")
    assert.equal(result.error, undefined, scenario.name)
    assert.notEqual(result.status, 0, scenario.name)
    assert.match(`${result.stdout}\n${result.stderr}`, scenario.expected, scenario.name)
  }
})

test("install and build failures return a nonzero exit status", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "quartz-plugin-failures-"))
  t.after(() => rm(root, { recursive: true, force: true }))

  const missingWorkspace = path.join(root, "missing")
  await writeWorkspaceLock(
    missingWorkspace,
    remoteLock(path.join(root, "does-not-exist"), "0123456789abcdef0123456789abcdef01234567"),
  )
  const missingResult = runPluginInstall(missingWorkspace)
  assert.equal(missingResult.error, undefined)
  assert.notEqual(missingResult.status, 0)
  assert.match(`${missingResult.stdout}\n${missingResult.stderr}`, /failed to clone/i)

  const buildWorkspace = path.join(root, "build")
  const brokenPlugin = path.join(buildWorkspace, ".quartz", "local-plugins", "broken-plugin")
  await mkdir(brokenPlugin, { recursive: true })
  await writeJson(path.join(brokenPlugin, "package.json"), {
    name: "@test/broken-plugin",
    version: "1.0.0",
    scripts: { build: 'node -e "process.exit(7)"' },
  })
  await writeJson(path.join(brokenPlugin, "package-lock.json"), {
    name: "@test/broken-plugin",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "@test/broken-plugin",
        version: "1.0.0",
      },
    },
  })
  await writeWorkspaceLock(buildWorkspace, {
    version: "1.0.0",
    plugins: {
      "broken-plugin": {
        source: {
          name: "broken-plugin",
          repo: "./.quartz/local-plugins/broken-plugin",
        },
        resolved: "Z:\\stale-host\\broken-plugin",
        commit: "local",
        installedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  })
  const buildResult = runPluginInstall(buildWorkspace)
  assert.equal(buildResult.error, undefined)
  assert.notEqual(buildResult.status, 0)
  assert.match(`${buildResult.stdout}\n${buildResult.stderr}`, /build failed/i)
})

test("lockfile Git metadata is rejected before clone or fetch", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "quartz-plugin-git-validation-"))
  t.after(() => rm(root, { recursive: true, force: true }))

  const validCommit = "0123456789abcdef0123456789abcdef01234567"
  const cases = [
    {
      name: "invalid-commit",
      overrides: { commit: "not-a-commit" },
      expected: /invalid locked git commit/i,
    },
    {
      name: "invalid-ref",
      overrides: { ref: "--upload-pack=malicious" },
      expected: /invalid git ref/i,
    },
    {
      name: "invalid-remote",
      overrides: { resolved: "--upload-pack=malicious" },
      expected: /invalid git remote/i,
    },
  ]

  for (const scenario of cases) {
    const workspace = path.join(root, scenario.name)
    await writeWorkspaceLock(workspace, {
      version: "1.0.0",
      plugins: {
        "pinned-plugin": {
          source: "git+https://example.invalid/pinned-plugin.git",
          resolved: "https://example.invalid/pinned-plugin.git",
          commit: validCommit,
          installedAt: "2026-01-01T00:00:00.000Z",
          ...scenario.overrides,
        },
      },
    })

    const result = runPluginInstall(workspace)
    assert.equal(result.error, undefined, scenario.name)
    assert.notEqual(result.status, 0, scenario.name)
    assert.match(`${result.stdout}\n${result.stderr}`, scenario.expected, scenario.name)
    assert.equal(
      existsSync(path.join(workspace, ".quartz", "plugins", "pinned-plugin")),
      false,
      scenario.name,
    )
  }
})

test("source builds select the package manager by lockfile and fail closed without one", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "quartz-plugin-manager-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pnpmPlugin = path.join(root, "pnpm-plugin")
  const npmPlugin = path.join(root, "npm-plugin")
  const unlockedPlugin = path.join(root, "unlocked-plugin")
  await Promise.all([pnpmPlugin, npmPlugin, unlockedPlugin].map((dir) => mkdir(dir)))
  await writeFile(path.join(pnpmPlugin, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
  await writeFile(path.join(npmPlugin, "package-lock.json"), "{}\n")

  assert.deepEqual(getPluginPackageCommands(pnpmPlugin), {
    manager: "pnpm",
    install: "pnpm install --frozen-lockfile --ignore-scripts",
    build: "pnpm run build",
    prune: "pnpm prune --prod --ignore-scripts",
  })
  assert.deepEqual(getPluginPackageCommands(npmPlugin), {
    manager: "npm",
    install: "npm ci --ignore-scripts",
    build: "npm run build",
    prune: "npm prune --omit=dev --ignore-scripts",
  })
  assert.throws(
    () => getPluginPackageCommands(unlockedPlugin),
    /no supported lockfile.*pnpm-lock\.yaml.*package-lock\.json/i,
  )

  const workspace = path.join(root, "unlocked-workspace")
  const plugin = path.join(workspace, ".quartz", "local-plugins", "unlocked-plugin")
  await mkdir(plugin, { recursive: true })
  await writeJson(path.join(plugin, "package.json"), {
    name: "@test/unlocked-plugin",
    version: "1.0.0",
    scripts: { build: 'node -e "process.exit(0)"' },
  })
  await writeWorkspaceLock(workspace, {
    version: "1.0.0",
    plugins: {
      "unlocked-plugin": {
        source: {
          name: "unlocked-plugin",
          repo: "./.quartz/local-plugins/unlocked-plugin",
        },
        resolved: "Z:\\stale-host\\unlocked-plugin",
        commit: "local",
        installedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  })

  const result = runPluginInstall(workspace)
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /no supported lockfile.*pnpm-lock\.yaml.*package-lock\.json/i,
  )
})

test("site workflows install only enabled plugins from the lockfile", async () => {
  const workflows = [
    ".github/workflows/ci.yaml",
    ".github/workflows/deploy-quartz.yml",
    ".github/workflows/build-preview.yaml",
    ".github/workflows/deploy-benchmark.yml",
  ]

  for (const relativePath of workflows) {
    const source = await readFile(path.join(repoRoot, relativePath), "utf8")
    assert.match(
      source,
      /node \.\/quartz\/bootstrap-cli\.mjs plugin install --enabled-only/,
      relativePath,
    )
    assert.doesNotMatch(source, /plugin install --from-config/, relativePath)
    assert.doesNotMatch(source, /^\s*path:\s*\.quartz\/plugins\s*$/m, relativePath)
  }
})
