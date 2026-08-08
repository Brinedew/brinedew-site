const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const target = targets.find(
  (entry) => entry.type === "page" && entry.title.includes("dev-vault") && entry.url.startsWith("app://"),
);
if (!target?.webSocketDebuggerUrl) throw new Error("Isolated Obsidian page was not found.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let messageId = 0;
const pending = new Map();
const requestedUrls = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Network.requestWillBeSent") {
    requestedUrls.push(message.params.request.url);
    return;
  }
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});

function send(method, params = {}) {
  const id = ++messageId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

await send("Runtime.enable");
await send("Network.enable");

const before = await evaluate(`(() => ({
  vault: app.vault.getName(),
  enabled: app.plugins.enabledPlugins.has("brinedew-prose-checker"),
  loaded: Boolean(app.plugins.plugins["brinedew-prose-checker"])
}))()`);

const reload = await evaluate(`(async () => {
  const id = "brinedew-prose-checker";
  await app.plugins.disablePlugin(id);
  const started = performance.now();
  await app.plugins.enablePlugin(id);
  return {
    enableWallMs: performance.now() - started,
    pluginStartupMs: app.plugins.plugins[id]?.startupMilliseconds ?? null,
    loaded: Boolean(app.plugins.plugins[id])
  };
})()`);

await evaluate(`(async () => {
  const file = app.vault.getAbstractFileByPath("Prose-checker-smoke.md");
  if (!file) throw new Error("Smoke note is missing.");
  await app.workspace.getLeaf(false).openFile(file);
  const editor = app.workspace.activeEditor?.editor;
  if (!editor) throw new Error("Smoke note editor is unavailable.");
  const cursor = editor.getCursor();
  editor.replaceRange(" ", cursor);
  editor.undo();
})()`);
await new Promise((resolve) => setTimeout(resolve, 10_000));

const harperOutcome = await evaluate(`(async () => {
  const initialization = app.plugins.plugins["brinedew-prose-checker"]?.harper?.initialization;
  if (!initialization) return { status: "not-started" };
  return Promise.race([
    initialization.then(() => ({ status: "ready" })).catch((error) => ({
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    })),
    new Promise((resolve) => setTimeout(() => resolve({ status: "pending" }), 2_000))
  ]);
})()`);

const after = await evaluate(`(() => ({
  title: document.title,
  commands: Object.keys(app.commands.commands).filter((id) => id.includes("brinedew-prose-checker")),
  paneButtons: [...document.querySelectorAll("[aria-label]")]
    .filter((element) => element.getAttribute("aria-label")?.includes("Check prose"))
    .length,
  statusText: [...document.querySelectorAll(".bpc-status-bar")]
    .map((element) => element.textContent?.trim()),
  harperInitialized: Boolean(
    app.plugins.plugins["brinedew-prose-checker"]?.harper?.linterInstance
  ),
  harperInitializationStarted: Boolean(
    app.plugins.plugins["brinedew-prose-checker"]?.harper?.initialization
  ),
  harperMarks: document.querySelectorAll(".cm-lintRange").length
}))()`);

const openCodeRequests = requestedUrls.filter((url) => url.startsWith("https://opencode.ai/"));
socket.close();

const report = {
  before,
  reload,
  after,
  harperOutcome,
  openCodeRequestsDuringReloadAndIdle: openCodeRequests.length,
};
process.stdout.write(`${JSON.stringify(report)}\n`);

if (
  before.vault !== "dev-vault" ||
  !before.enabled ||
  !before.loaded ||
  !reload.loaded ||
  reload.pluginStartupMs === null ||
  reload.pluginStartupMs >= 50 ||
  after.commands.length < 3 ||
  after.paneButtons < 1 ||
  after.statusText[0] !== "Prose check: idle" ||
  !after.harperInitialized ||
  openCodeRequests.length !== 0
) {
  process.exitCode = 1;
}
