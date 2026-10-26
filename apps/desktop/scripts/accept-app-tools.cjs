/* eslint @typescript-eslint/no-require-imports: off */
/* global require, __dirname */
/**
 * D16 software acceptance with the production Electron main/preload/renderer,
 * stdio Host and pinned Harness. The only model endpoint is a local Messages
 * server with a public dummy credential. No production test hooks are added.
 *
 * Prerequisites:
 *   pnpm --filter @deepseek-bot/host build
 *   pnpm --filter @deepseek-bot/desktop build
 * Run from the repository root:
 *   pnpm --dir apps/desktop exec electron scripts/accept-app-tools.cjs
 * Evidence is written to an isolated, ignored .tmp-d16-electron-* directory.
 */
const { app } = require("electron");
const process = require("node:process");
const { setTimeout } = require("node:timers");
const { createServer } = require("node:http");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const evidence = mkdtempSync(join(repoRoot, ".tmp-d16-electron-"));
const userData = join(evidence, "electron-user-data");
mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
app.setAppPath(desktopRoot);
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
process.env.DEEPSEEK_BOT_DATA_ROOT = join(evidence, "host-data");
delete process.env.ELECTRON_RENDERER_URL;

const APP_TOOLS = ["list_bots", "list_groups", "get_run", "get_run_events", "create_bot_draft", "create_group", "create_bots_batch", "revoke_batch"];
const finalText = "Group created after human approval in Electron.";
const groupName = "D16 Electron controlled group";
const bodies = [];
const errors = [];
let completed = false;
let primaryWindow;
let currentStage = "start controlled local provider";

function assert(value, message) {
  if (!value) throw new Error(message);
}

function streamMessage(response, tool) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const event = (type, body) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`);
  event("message_start", { message: { id: "local-electron-message", type: "message", role: "assistant", model: "deepseek-chat", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } });
  if (tool) {
    event("content_block_start", { index: 0, content_block: { type: "tool_use", id: `electron-${tool}`, name: tool, input: {} } });
    event("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(tool === "create_group" ? { name: groupName } : {}) } });
  } else {
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    event("content_block_delta", { index: 0, delta: { type: "text_delta", text: finalText } });
  }
  event("content_block_stop", { index: 0 });
  event("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } });
  event("message_stop", {});
  response.end();
}

const provider = createServer((request, response) => {
  void (async () => {
    let raw = "";
    for await (const part of request) raw += String(part);
    if (request.url !== "/v1/messages") return response.writeHead(404).end();
    const body = JSON.parse(raw);
    bodies.push(body);
    streamMessage(response, bodies.length === 1 ? "list_groups" : bodies.length === 2 ? "create_group" : undefined);
  })().catch((error) => {
    errors.push(String(error));
    response.writeHead(500).end();
  });
});

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
async function waitFor(check, label, timeout = 45_000) {
  const until = Date.now() + timeout;
  let last;
  do {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { last = error; }
    await delay(100);
  } while (Date.now() < until);
  throw new Error(`${label} timed out${last ? `: ${String(last)}` : ""}`);
}
const evaluate = (source) => primaryWindow.webContents.executeJavaScript(source, true);
const hostCall = (method, payload) => evaluate(`window.deepseekBot.host.call(${JSON.stringify(method)}, ${JSON.stringify(payload)})`);
async function snapshot(name) {
  const image = await Promise.race([
    primaryWindow.webContents.capturePage(),
    delay(3_000).then(() => { throw new Error("screenshot capture timed out"); }),
  ]);
  writeFileSync(join(evidence, name), image.toPNG());
}

async function finish(error) {
  if (completed) return;
  completed = true;
  if (error) errors.push(`${currentStage}: ${String(error)}`);
  try { if (primaryWindow && !primaryWindow.isDestroyed()) await snapshot(error ? "failure.png" : "completed.png"); } catch { /* Keep original failure. */ }
  const report = {
    ok: error === undefined,
    at: new Date().toISOString(),
    stage: currentStage,
    electron: process.versions.electron,
    providerRequests: bodies.length,
    appTools: (bodies[0]?.tools ?? []).map((tool) => tool.name).filter((name) => APP_TOOLS.includes(name)),
    errors,
    evidence,
  };
  writeFileSync(join(evidence, "result.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  provider.closeAllConnections();
  provider.close();
  process.exitCode = error ? 1 : 0;
  app.quit();
  setTimeout(() => app.exit(error ? 1 : 0), 4_000).unref();
}

async function accept() {
  currentStage = "production preload and Host ready";
  await waitFor(() => evaluate("Boolean(window.deepseekBot?.host && document.querySelector('.shell'))"), "renderer ready", 20_000);
  await waitFor(async () => Boolean(await hostCall("bot.list", {})), "Host ready", 20_000);
  currentStage = "safeStorage dummy key and seed bot";
  await evaluate("window.deepseekBot.settings.saveKey('sk-local-controlled-electron-only')");
  const bot = await hostCall("bot.create", {
    name: "D16 Acceptance Bot",
    instructions: "Use list_groups, then create_group for the requested group; report the result.",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  });
  const loaded = new Promise((resolveLoaded) => primaryWindow.webContents.once("did-finish-load", resolveLoaded));
  primaryWindow.webContents.reload();
  await loaded;
  currentStage = "select bot and send through production composer";
  await waitFor(() => evaluate(`Array.from(document.querySelectorAll('button.tab')).some(button => button.textContent.includes('D16 Acceptance Bot'))`), "seeded bot visible");
  await evaluate(`Array.from(document.querySelectorAll('button.tab')).find(button => button.textContent.includes('D16 Acceptance Bot')).click()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('input.composer-input'))"), "chat composer visible");
  await evaluate(`(() => {
    const input = document.querySelector('input.composer-input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Create ${groupName}.');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(() => evaluate("!document.querySelector('button.send-btn').disabled"), "composer accepts input");
  await evaluate("document.querySelector('button.send-btn').click()");
  currentStage = "read and approval request through real Harness";
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"授权 create_group\"]'))"), "actual approval card", 45_000);
  const preview = await evaluate("document.querySelector('[aria-label=\"待执行参数\"]').textContent");
  assert(JSON.parse(preview).name === groupName, "card did not show exact validated parameters");
  const before = await hostCall("group.list", {});
  assert(before.groups.length === 0, "group was written before approval");
  assert(APP_TOOLS.every((name) => bodies[0].tools.some((tool) => tool.name === name)), "model did not see all eight application tools");
  assert(!bodies[0].tools.some((tool) => tool.name.startsWith("permission.")), "permission control method exposed to model");
  await evaluate(`async function revealCard() {
    const card = document.querySelector('[aria-label="授权 create_group"]');
    card.scrollIntoView({ block: 'center' });
    await new Promise(resolvePaint => requestAnimationFrame(() => requestAnimationFrame(resolvePaint)));
    const button = Array.from(card.querySelectorAll('button')).find(item => item.textContent === '仅本次');
    const rect = card.getBoundingClientRect();
    const action = button.getBoundingClientRect();
    const viewport = document.querySelector('.chat').getBoundingClientRect();
    const hit = document.elementFromPoint(action.x + action.width / 2, action.y + action.height / 2);
    if (rect.top < viewport.top || rect.bottom > viewport.bottom || rect.top < 0 || rect.bottom > innerHeight || !button.contains(hit)) {
      throw new Error('actual authorization card is not visible: ' + JSON.stringify({ card: rect.toJSON(), viewport: viewport.toJSON(), button: action.toJSON() }));
    }
  }; revealCard()`);
  await snapshot("approval.png");
  currentStage = "click once card and continue original call";
  await evaluate("Array.from(document.querySelector('[aria-label=\"授权 create_group\"]').querySelectorAll('button')).find(button => button.textContent === '仅本次').click()");
  await waitFor(() => evaluate(`document.body.textContent.includes(${JSON.stringify(finalText)})`), "model final answer in renderer", 20_000);
  const after = await hostCall("group.list", {});
  assert(after.groups.length === 1 && after.groups[0].name === groupName, "approved operation did not write exactly one group");
  assert(bodies.length === 3, "expected read, write and final model requests");
  assert(JSON.stringify(bodies[2].messages).includes(groupName), "created group result did not reach model");
  const approvals = await hostCall("permission.approval.list", { botId: bot.id });
  assert(!approvals.approvals.some((approval) => approval.status === "pending"), "pending approval remained after success");
  const audit = readFileSync(join(process.env.DEEPSEEK_BOT_DATA_ROOT, "logs", "agent-tools-audit.jsonl"), "utf8");
  assert(!audit.includes(groupName), "audit leaked raw tool parameters");
  currentStage = "verified real Electron approval and model continuation";
  await finish();
}

app.on("browser-window-created", (_event, win) => {
  if (primaryWindow) return;
  primaryWindow = win;
  win.webContents.once("did-finish-load", () => { void accept().catch(finish); });
});
provider.listen(0, "127.0.0.1", () => {
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${provider.address().port}`;
  require(join(desktopRoot, "out", "main", "index.cjs"));
});
setTimeout(() => { void finish(new Error("overall acceptance deadline exceeded")); }, 90_000).unref();
