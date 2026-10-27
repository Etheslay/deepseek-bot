/* eslint @typescript-eslint/no-require-imports: off */
/* global require, __dirname */
/**
 * D19 acceptance: production Electron main/preload/renderer, stdio Host and
 * pinned Harness against controlled loopback Messages and MCP servers.
 * Build: pnpm --filter @deepseek-bot/host build
 *        pnpm --filter @deepseek-bot/desktop build
 * Run: pnpm --dir apps/desktop exec electron scripts/accept-mcp.cjs
 * All keys are dummy; runtime data/evidence stays in ignored .tmp-d19-electron-*.
 */
const { app } = require("electron");
const process = require("node:process");
const { setTimeout } = require("node:timers");
const { createServer } = require("node:http");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const evidence = mkdtempSync(join(repoRoot, ".tmp-d19-electron-"));
const userData = join(evidence, "electron-user-data");
mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
app.setAppPath(desktopRoot);
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
process.env.DEEPSEEK_BOT_DATA_ROOT = join(evidence, "host-data");
delete process.env.ELECTRON_RENDERER_URL;
const APP_TOOLS = ["list_bots", "list_groups", "get_run", "get_run_events", "create_bot_draft", "create_group", "create_bots_batch", "revoke_batch"];
const finalText = "MCP echo completed after single-use human approval.";
const echoText = "Electron local echo";
const resultText = `MCP echo result: ${echoText}`;
const botName = "D19 MCP Acceptance Bot";
const connectorName = "D19 Local Echo MCP";
const bodies = [];
const calls = [];
const errors = [];
let completed = false;
let primaryWindow;
let currentStage = "start controlled local servers";
let savedGrant;
let cardPreview;
const assert = (value, message) => { if (!value) throw new Error(message); };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(check, label, timeout = 45_000) {
  const until = Date.now() + timeout;
  let last;
  do {
    try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await delay(100);
  } while (Date.now() < until);
  throw new Error(`${label} timed out${last ? `: ${String(last)}` : ""}`);
}
const evaluate = (source) => Promise.race([primaryWindow.webContents.executeJavaScript(source, true), delay(15_000).then(() => { throw new Error("renderer evaluation timed out"); })]);
const hostCall = (method, payload) => evaluate(`window.deepseekBot.host.call(${JSON.stringify(method)}, ${JSON.stringify(payload)})`);
async function snapshot(name) {
  primaryWindow.show();
  primaryWindow.focus();
  await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
  await waitFor(() => evaluate("document.getAnimations().every(animation => animation.effect?.getTiming().iterations === Infinity || animation.playState !== 'running')"), "finite UI animations complete", 5_000);
  const image = await Promise.race([primaryWindow.webContents.capturePage(), delay(3_000).then(() => { throw new Error("screenshot capture timed out"); })]);
  writeFileSync(join(evidence, name), image.toPNG());
}
function streamMessage(response, tool) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const event = (type, body) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`);
  event("message_start", { message: { id: "local-electron-mcp-message", type: "message", role: "assistant", model: "deepseek-chat", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } });
  if (tool) {
    event("content_block_start", { index: 0, content_block: { type: "tool_use", id: "electron-mcp-echo", name: tool, input: {} } });
    event("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ text: echoText }) } });
  } else {
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    event("content_block_delta", { index: 0, delta: { type: "text_delta", text: finalText } });
  }
  event("content_block_stop", { index: 0 });
  event("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } });
  event("message_stop", {});
  response.end();
}
function guarded(handler) {
  return (request, response) => void handler(request, response).catch((error) => {
    errors.push(String(error));
    response.writeHead(500).end();
  });
}
async function readBody(request) { let raw = ""; for await (const part of request) raw += String(part); return JSON.parse(raw); }
const provider = createServer(guarded(async (request, response) => {
  if (request.url !== "/v1/messages" || request.method !== "POST") return response.writeHead(404).end();
  const body = await readBody(request);
  bodies.push(body);
  const tool = bodies.length === 1 ? body.tools?.find((item) => /^mcp__/.test(item.name))?.name : undefined;
  if (bodies.length === 1) assert(tool, "authorized MCP tool missing from real model request");
  streamMessage(response, tool);
}));
const mcp = createServer(guarded(async (request, response) => {
  if (request.url !== "/mcp" || request.method !== "POST") return response.writeHead(404).end();
  const rpc = await readBody(request);
  if (rpc.id === undefined) return response.writeHead(202).end();
  let result;
  if (rpc.method === "initialize") result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "electron-acceptance-echo", version: "1.0.0" } };
  else if (rpc.method === "tools/list") result = { tools: [
    { name: "echo", description: "Echo local text", inputSchema: { type: "object", properties: { text: { type: "string", maxLength: 100 } }, required: ["text"], additionalProperties: false } },
    { name: "unselected", description: "Must never be authorized", inputSchema: { type: "object", additionalProperties: false } },
  ] };
  else if (rpc.method === "tools/call") {
    calls.push(rpc.params);
    assert(rpc.params?.name === "echo" && rpc.params.arguments?.text === echoText, "unexpected MCP call");
    result = { content: [{ type: "text", text: resultText }] };
  } else return response.writeHead(400).end();
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
}));
async function finish(error) {
  if (completed) return;
  completed = true;
  if (error) errors.push(`${currentStage}: ${String(error)}`);
  try { if (primaryWindow && !primaryWindow.isDestroyed()) await snapshot(error ? "failure.png" : "completed.png"); } catch (captureError) { errors.push(`evidence capture failed: ${String(captureError)}`); }
  const harness = JSON.parse(readFileSync(join(repoRoot, "packages", "harness-adapter", "package.json"), "utf8"));
  const report = { ok: error === undefined && errors.length === 0, at: new Date().toISOString(), stage: currentStage,
    versions: { electron: process.versions.electron, node: process.versions.node, harness: harness.dependencies["@deepseek-ai/dsh"] },
    providerRequests: bodies.length, mcpCalls: calls.length, resultReceivedByModel: (JSON.stringify(bodies[1]?.messages) ?? "").includes(resultText),
    modelTools: (bodies[0]?.tools ?? []).map((tool) => tool.name), savedGrant, cardPreview,
    evidence: { directory: evidence, settings: join(evidence, "settings.png"), approval: join(evidence, "approval.png"), completed: join(evidence, "completed.png") }, errors };
  writeFileSync(join(evidence, "result.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  for (const server of [provider, mcp]) { server.closeAllConnections(); server.close(); }
  process.exitCode = report.ok ? 0 : 1;
  app.quit();
  setTimeout(() => app.exit(report.ok ? 0 : 1), 4_000).unref();
}
async function accept() {
  currentStage = "production preload and Host ready"; process.stdout.write(`[accept-mcp] ${currentStage}\n`);
  await waitFor(() => evaluate("Boolean(window.deepseekBot?.host && document.querySelector('.shell'))"), "renderer ready", 20_000);
  await waitFor(async () => Boolean(await hostCall("bot.list", {})), "Host ready", 20_000);
  await evaluate("window.deepseekBot.settings.saveKey('sk-local-controlled-electron-only')");
  const bot = await hostCall("bot.create", { name: botName, instructions: "Use the authorized MCP echo tool to echo the requested text, then report success.", modelProfileId: "44444444-4444-4444-8444-444444444444", workspaceId: "55555555-5555-4555-8555-555555555555", toolPolicyId: "66666666-6666-4666-8666-666666666666" });
  const connector = await hostCall("connector.register", { name: connectorName, kind: "mcp-http", endpoint: `http://127.0.0.1:${mcp.address().port}/mcp` });
  await hostCall("connector.enable", { id: connector.id });
  const loaded = new Promise((done) => primaryWindow.webContents.once("did-finish-load", done));
  primaryWindow.webContents.reload();
  await loaded;
  currentStage = "discover and explicitly grant echo in settings UI"; process.stdout.write(`[accept-mcp] ${currentStage}\n`);
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"打开设置\"]'))"), "settings button ready");
  await evaluate("document.querySelector('[aria-label=\"打开设置\"]').click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"MCP 机器人\"] option'))"), "MCP settings loaded");
  for (const [label, value] of [["MCP 机器人", bot.id], ["MCP 服务", connector.id]]) {
    await evaluate(`(() => { const select = document.querySelector('[aria-label="${label}"]'); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }
  await waitFor(() => evaluate("Array.from(document.querySelector('[aria-label=\"MCP 工具授权\"]').querySelectorAll('button')).some(button => button.textContent === '发现工具' && !button.disabled)"), "discovery enabled");
  await evaluate("Array.from(document.querySelector('[aria-label=\"MCP 工具授权\"]').querySelectorAll('button')).find(button => button.textContent === '发现工具').click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"允许工具 echo\"]'))"), "real MCP discovery");
  assert(await evaluate("Array.from(document.querySelectorAll('[aria-label=\"MCP 工具授权\"] input[type=checkbox]')).every(input => !input.checked)"), "discovered tools were auto-selected");
  await evaluate("document.querySelector('[aria-label=\"允许工具 echo\"]').click()");
  await evaluate("Array.from(document.querySelector('[aria-label=\"MCP 工具授权\"]').querySelectorAll('button')).find(button => button.textContent === '保存工具白名单').click()");
  savedGrant = await waitFor(async () => { const grant = await hostCall("connector.mcp.grants.get", { botId: bot.id }); return grant.servers.some((server) => server.serverId === connector.id && JSON.stringify(server.allowedTools) === '["echo"]') && grant; }, "saved echo-only grant");
  await waitFor(() => evaluate("document.body.textContent.includes('已保存工具白名单')"), "save confirmation");
  await evaluate("document.querySelector('[aria-label=\"MCP 工具授权\"]').scrollIntoView({ block: 'center' })");
  await snapshot("settings.png");
  await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()");
  currentStage = "chat requests dynamic authorized MCP tool through real Harness"; process.stdout.write(`[accept-mcp] ${currentStage}\n`);
  await waitFor(() => evaluate(`Array.from(document.querySelectorAll('button.tab')).some(button => button.textContent.includes(${JSON.stringify(botName)}))`), "seeded bot visible");
  await evaluate(`Array.from(document.querySelectorAll('button.tab')).find(button => button.textContent.includes(${JSON.stringify(botName)})).click()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('input.composer-input'))"), "composer visible");
  await evaluate(`(() => { const input = document.querySelector('input.composer-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(`Echo ${echoText} through MCP.`)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(() => evaluate("!document.querySelector('button.send-btn').disabled"), "composer accepts input");
  await evaluate("document.querySelector('button.send-btn').click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"授权 mcp_call\"]'))"), "MCP approval card");
  currentStage = "verify exact preview and no pre-approval MCP execution"; process.stdout.write(`[accept-mcp] ${currentStage}\n`);
  cardPreview = JSON.parse(await evaluate("document.querySelector('[aria-label=\"待执行参数\"]').textContent"));
  assert(cardPreview.connectorName === connectorName && cardPreview.toolName === "echo" && cardPreview.arguments.text === echoText, "MCP approval preview mismatch");
  assert(calls.length === 0, "MCP tools/call executed before approval");
  const names = bodies[0].tools.map((tool) => tool.name);
  assert(APP_TOOLS.every((name) => names.includes(name)), "expected eight app tools missing");
  assert(names.filter((name) => name.startsWith("mcp__")).length === 1, "unselected MCP tool exposed");
  assert(!names.some((name) => /^(connector\.|permission\.)/.test(name)), "control-plane methods exposed to model");
  const buttons = await evaluate("Array.from(document.querySelector('[aria-label=\"授权 mcp_call\"]').querySelectorAll('button')).map(button => button.textContent)");
  assert(buttons.includes("仅本次") && !buttons.some((text) => /本会话|永久/.test(text)), "MCP approval offered broader scope");
  await evaluate("document.querySelector('[aria-label=\"授权 mcp_call\"]').scrollIntoView({ block: 'center' })");
  await snapshot("approval.png");
  currentStage = "approve once and verify result reaches model"; process.stdout.write(`[accept-mcp] ${currentStage}\n`);
  await evaluate("Array.from(document.querySelector('[aria-label=\"授权 mcp_call\"]').querySelectorAll('button')).find(button => button.textContent === '仅本次').click()");
  await waitFor(() => evaluate(`document.body.textContent.includes(${JSON.stringify(finalText)})`), "final model answer", 60_000);
  assert(calls.length === 1, "expected exactly one MCP tools/call");
  assert(bodies.length === 2 && JSON.stringify(bodies[1].messages).includes(resultText), "MCP result did not reach model continuation");
  const approvals = await hostCall("permission.approval.list", { botId: bot.id });
  assert(!approvals.approvals.some((approval) => approval.status === "pending"), "approval remained pending");
  assert(errors.length === 0, "controlled server failed");
  currentStage = "verified settings grant, single-use approval and real Harness MCP continuation"; process.stdout.write(`[accept-mcp] ${currentStage}\n`);
  await finish();
}
app.on("browser-window-created", (_event, win) => {
  if (primaryWindow) return;
  primaryWindow = win;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once("did-finish-load", () => { void accept().catch(finish); });
});
Promise.all([provider, mcp].map((server) => new Promise((done) => server.listen(0, "127.0.0.1", done)))).then(() => {
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${provider.address().port}`;
  require(join(desktopRoot, "out", "main", "index.cjs"));
}).catch(finish);
setTimeout(() => { void finish(new Error("overall acceptance deadline exceeded")); }, 240_000).unref();
