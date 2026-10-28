/* eslint @typescript-eslint/no-require-imports: off */
/* global require, __dirname */
/**
 * D21 real Electron + stdio Host + native PrintWindow + offline OCR acceptance.
 * Build Host and desktop first, then:
 * pnpm --dir apps/desktop exec electron scripts/accept-screen.cjs
 * Only the app-owned random-title WinForms fixture is ever selected/captured.
 * A loopback-only model endpoint and dummy key exercise the real Harness.
 * Runtime artifacts/evidence stay under ignored .tmp-d21-electron-*.
 */
const { app } = require("electron");
const process = require("node:process");
const { setTimeout, clearTimeout } = require("node:timers");
const { spawn, execFile } = require("node:child_process");
const { createServer } = require("node:http");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } = require("node:fs");
const { randomUUID, randomInt } = require("node:crypto");
const { join, resolve } = require("node:path");
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const evidence = mkdtempSync(join(repoRoot, ".tmp-d21-electron-"));
const userData = join(evidence, "electron-user-data");
for (const directory of [userData]) mkdirSync(directory, { recursive: true });
app.setPath("userData", userData);
app.setAppPath(desktopRoot);
for (const flag of ["disable-background-timer-throttling", "disable-renderer-backgrounding", "disable-backgrounding-occluded-windows"]) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
process.env.DEEPSEEK_BOT_DATA_ROOT = join(evidence, "host-data");
delete process.env.ELECTRON_RENDERER_URL;

const finalText = "Selected-window capture completed. Only result metadata was received.";
const botName = "D21 owned-window acceptance";
const fixtureTitle = `dsb-screen-${randomUUID()}`;
const syntheticText = "HELLO LOCAL OCR 12345";
const powershell = join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
const bodies = [];
const errors = [];
const checkpoints = {};
let completed = false;
let primaryWindow;
let fixture;
let ownedWindow;
let hostNodeVersion;
let currentStage = "start owned synthetic fixture";
const assert = (value, message) => { if (!value) throw new Error(message); };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(check, label, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`${label} timed out${last ? `: ${String(last)}` : ""}`);
}
const evaluate = (source) => Promise.race([primaryWindow.webContents.executeJavaScript(source, true), delay(15_000).then(() => { throw new Error("renderer evaluation timed out"); })]);
const hostCall = (method, payload) => evaluate(`window.deepseekBot.host.call(${JSON.stringify(method)}, ${JSON.stringify(payload)})`);
const stage = (value) => { currentStage = value; process.stdout.write(`[accept-screen] ${value}\n`); };
async function click(text, scope = "document") {
  const source = `Array.from(${scope}.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(text)} && !button.disabled)`;
  await waitFor(() => evaluate(`Boolean(${source})`), `enabled ${text}`);
  await evaluate(`${source}.click()`);
}
async function snapshot(name, target) {
  // Captures this test's Electron renderer only, never the screen/desktop.
  primaryWindow.show(); primaryWindow.focus();
  await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
  if (target) {
    // Focus and pending renderer updates can reset a prior scroll. Position the
    // evidence target after focus, then require its complete visible rectangle.
    await waitFor(() => evaluate(`(async () => {
      const element = ${target};
      if (!element) return false;
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      const bounds = element.getBoundingClientRect();
      const viewport = element.closest('.settings-body')?.getBoundingClientRect();
      return bounds.height > 0 && bounds.top >= (viewport?.top ?? 0) - 1 && bounds.bottom <= (viewport?.bottom ?? innerHeight) + 1;
    })()`), `visible evidence target ${name}`, 10_000);
  }
  const image = await Promise.race([primaryWindow.webContents.capturePage(), delay(5_000).then(() => { throw new Error("renderer screenshot timed out"); })]);
  writeFileSync(join(evidence, name), image.toPNG());
}
function publishedFiles(botId) {
  const directory = join(process.env.DEEPSEEK_BOT_DATA_ROOT, "screen-outputs", botId);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith(".")).map(entry => entry.name);
}
function pendingImages(botId) {
  const directory = join(process.env.DEEPSEEK_BOT_DATA_ROOT, "screen-outputs", botId);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.startsWith(".tmp-"));
}
async function approval(botId) {
  return waitFor(async () => {
    const { approvals } = await hostCall("permission.approval.list", { botId, status: "pending" });
    assert(approvals.length <= 1, "multiple approvals unexpectedly pending");
    const pending = approvals[0];
    if (pending) assert(pending.tool === "screen_capture" && pending.params.windowTitle === fixtureTitle, "approval does not target our fixture");
    return pending;
  }, "single-use screen approval");
}
function streamMessage(response, tool) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const event = (type, body) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`);
  event("message_start", { message: { id: "local-screen-message", type: "message", role: "assistant", model: "deepseek-chat", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } });
  if (tool) {
    event("content_block_start", { index: 0, content_block: { type: "tool_use", id: "owned-screen-ocr", name: "screen_capture", input: {} } });
    event("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ mode: "ocr" }) } });
  } else {
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    event("content_block_delta", { index: 0, delta: { type: "text_delta", text: finalText } });
  }
  event("content_block_stop", { index: 0 });
  event("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } });
  event("message_stop", {}); response.end();
}
const provider = createServer((request, response) => void (async () => {
  if (request.url !== "/v1/messages" || request.method !== "POST") return response.writeHead(404).end();
  let raw = ""; for await (const part of request) raw += String(part);
  const body = JSON.parse(raw); bodies.push(body);
  if (bodies.length === 1) {
    const tool = body.tools?.find(item => item.name === "screen_capture");
    assert(tool, "screen_capture missing from authorized model catalog");
    assert(!JSON.stringify(tool.input_schema ?? tool.parameters).includes("selectionId"), "internal selection leaked into model tool parameters");
  }
  streamMessage(response, bodies.length === 1);
})().catch(error => { errors.push(String(error)); response.writeHead(500).end(); }));

async function finish(error) {
  if (completed) return;
  completed = true;
  if (error) errors.push(`${currentStage}: ${String(error)}`);
  try { if (primaryWindow && !primaryWindow.isDestroyed()) await snapshot(error ? "failure.png" : "completed.png"); } catch (captureError) { errors.push(`evidence capture failed: ${String(captureError)}`); }
  if (fixture && !fixture.killed) fixture.kill();
  provider.closeAllConnections(); provider.close();
  const report = { ok: error === undefined && errors.length === 0, at: new Date().toISOString(), stage: currentStage,
    versions: { electron: process.versions.electron, electronNode: process.versions.node, hostNode: hostNodeVersion, harness: JSON.parse(readFileSync(join(repoRoot, "packages/harness-adapter/package.json"), "utf8")).dependencies["@deepseek-ai/dsh"] }, checkpoints, providerRequests: bodies.length,
    evidence: { directory: evidence, ocrApproval: join(evidence, "ocr-approval.png"), completed: join(evidence, "completed.png"), ocrPreview: join(evidence, "ocr-preview.png"), settings: join(evidence, "settings.png"), approval: join(evidence, "approval.png"), preview: join(evidence, "preview.png") }, errors };
  writeFileSync(join(evidence, "result.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`); process.exitCode = report.ok ? 0 : 1;
  app.once("will-quit", () => app.exit(report.ok ? 0 : 1));
  app.quit(); setTimeout(() => app.exit(report.ok ? 0 : 1), 4_000).unref();
}
async function accept() {
  stage("production preload and isolated Host ready");
  await waitFor(() => evaluate("Boolean(window.deepseekBot?.host && document.querySelector('.shell'))"), "renderer ready", 25_000);
  await waitFor(async () => Boolean(await hostCall("bot.list", {})), "Host ready", 25_000);
  await evaluate("window.deepseekBot.settings.saveKey('sk-local-screen-acceptance-only')");
  const bot = await hostCall("bot.create", { name: botName, instructions: "Use screen_capture with mode ocr once. Report only completion; do not request screen pixel data or recognized text.", modelProfileId: "44444444-4444-4444-8444-444444444444", workspaceId: "55555555-5555-4555-8555-555555555555", toolPolicyId: "66666666-6666-4666-8666-666666666666" });
  const initial = await hostCall("screen.status", { botId: bot.id });
  assert(initial.supported && !initial.enabled && initial.target === null, "screen must start disabled with no target");
  checkpoints.defaultDenied = true;
  const loaded = new Promise(done => primaryWindow.webContents.once("did-finish-load", done)); primaryWindow.webContents.reload(); await loaded;
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"打开设置\"]'))"), "settings button");
  await evaluate("document.querySelector('[aria-label=\"打开设置\"]').click()");
  await click("权限", "document.querySelector('.settings-nav')");
  const scope = "document.querySelector('[data-testid=\"screen-settings\"]')";
  await waitFor(() => evaluate(`Boolean(${scope}?.querySelector('[aria-label="采集目标"] option'))`), "screen settings bot");
  stage("explicitly enable screen sensing and select the owned fixture only");
  await evaluate(`(() => { const select = ${scope}.querySelector('[aria-label="采集目标"]'); select.value = ${JSON.stringify(bot.id)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => evaluate(`${scope}.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false'`), "default deny visible");
  await evaluate(`${scope}.querySelector('[role="switch"]').click()`);
  await waitFor(async () => (await hostCall("screen.status", { botId: bot.id })).enabled, "ask policy enabled");
  await assertOwnedIdentity(); await click("刷新窗口", scope);
  const token = await waitFor(() => evaluate(`Array.from(document.querySelector('[aria-label="目标窗口"]').options).find(option => option.textContent === ${JSON.stringify(ownedWindow.title)})?.value`), "owned fixture in window list");
  assert(token && token !== ownedWindow.hwnd, "window selection must use opaque Host token");
  await evaluate(`(() => { const select = document.querySelector('[aria-label="目标窗口"]'); select.value = ${JSON.stringify(token)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(async () => (await hostCall("screen.status", { botId: bot.id })).target?.title === ownedWindow.title, "selected fixture target");
  await evaluate(`${scope}.scrollIntoView({ block: 'center', behavior: 'instant' })`); await snapshot("settings.png");
  stage("reject and cancel pending captures without image artifacts");
  await assertOwnedIdentity(); await click("截图", scope); await approval(bot.id);
  assert(pendingImages(bot.id).length === 0 && publishedFiles(bot.id).length === 0, "capture artifact appeared before approval");
  const collision = await evaluate(`window.deepseekBot.host.call('screen.request', ${JSON.stringify({ botId: bot.id, mode: "image" })}).then(() => 'unexpected-success', error => String(error))`);
  assert(/RATE_LIMITED|already|busy/i.test(collision), "concurrent request did not fail with the single-operation lock");
  checkpoints.concurrentCaptureRejected = true;
  await click("拒绝", "document.querySelector('[aria-label=\"授权 screen_capture\"]')");
  await waitFor(async () => (await hostCall("permission.approval.list", { botId: bot.id, status: "pending" })).approvals.length === 0, "rejection completed");
  assert(publishedFiles(bot.id).length === 0 && pendingImages(bot.id).length === 0, "rejected capture created image artifacts");
  await assertOwnedIdentity(); await click("截图", scope); await approval(bot.id); await click("取消", scope);
  await waitFor(async () => (await hostCall("permission.approval.list", { botId: bot.id, status: "pending" })).approvals.length === 0, "cancellation completed");
  assert(publishedFiles(bot.id).length === 0 && pendingImages(bot.id).length === 0, "cancelled capture created image artifacts");
  await assertOwnedIdentity(); await click("截图", scope); await approval(bot.id);
  await evaluate(`${scope}.querySelector('[role="switch"]').click()`);
  await waitFor(async () => !(await hostCall("screen.status", { botId: bot.id })).enabled, "disable cancels pending request");
  await waitFor(async () => (await hostCall("permission.approval.list", { botId: bot.id })).approvals.length === 0, "disabled approval cancelled");
  assert(publishedFiles(bot.id).length === 0 && pendingImages(bot.id).length === 0, "disabled pending capture created artifacts");
  checkpoints.disableCancelsPending = true;
  await waitFor(() => evaluate(`${scope}.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false' && ${scope}.textContent.includes('从不允许')`), "disabled policy rendered");
  await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
  await evaluate(`${scope}.querySelector('[role="switch"]').click()`);
  await waitFor(async () => (await hostCall("screen.status", { botId: bot.id })).enabled, "restore ask policy");
  checkpoints.noImageArtifactsBeforeApprovalOrAfterDenyCancel = true;
  stage("approve image capture once and preview local JPEG");
  await assertOwnedIdentity(); await click("截图", scope); await approval(bot.id);
  const card = "document.querySelector('[aria-label=\"授权 screen_capture\"]')";
  await waitFor(() => evaluate(`Boolean(${card})`), "rendered single-use approval card");
  const cardButtons = await evaluate(`Array.from(${card}.querySelectorAll('button')).map(button => button.textContent)`);
  assert(cardButtons.includes("仅本次") && !cardButtons.some(text => /本会话|永久/.test(text)), "screen approval offered persistent scope");
  await evaluate(`${card}.scrollIntoView({ block: 'center', behavior: 'instant' })`); await snapshot("approval.png", card);
  await assertOwnedIdentity();
  await click("仅本次", card);
  const imageResult = await waitFor(async () => (await hostCall("screen.results.list", { botId: bot.id })).results.find(result => result.mode === "image"), "native image publication", 25_000);
  assert(imageResult.width > 500 && imageResult.height > 200 && !imageResult.hasOcr, "native fixture image metadata invalid");
  await click("查看", scope);
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"本机预览\"] img')?.src.startsWith('data:image/jpeg;base64,'))"), "local JPEG preview");
  await snapshot("preview.png", `${scope}.querySelector('.screen-preview')`);
  checkpoints.nativeImagePreview = true;
  stage("real Harness requests OCR for the same owned window");
  await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()");
  await waitFor(() => evaluate(`Array.from(document.querySelectorAll('button.tab')).some(button => button.textContent.includes(${JSON.stringify(botName)}))`), "acceptance bot tab");
  await evaluate(`Array.from(document.querySelectorAll('button.tab')).find(button => button.textContent.includes(${JSON.stringify(botName)})).click()`);
  await waitFor(() => evaluate("Boolean(document.querySelector('input.composer-input'))"), "chat composer");
  await evaluate(`(() => { const input = document.querySelector('input.composer-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Capture the selected test window with local OCR.'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(() => evaluate("!document.querySelector('button.send-btn').disabled"), "send enabled");
  await evaluate("document.querySelector('button.send-btn').click()");
  const ocrApproval = await approval(bot.id);
  assert(ocrApproval.params.mode === "ocr" && ocrApproval.params.windowTitle === ownedWindow.title, "OCR preview targeted an unexpected window");
  assert(publishedFiles(bot.id).length === 1 && pendingImages(bot.id).length === 0, "OCR artifact appeared before approval");
  await assertOwnedIdentity();
  await waitFor(() => evaluate(`Boolean(${card})`), "rendered OCR approval card");
  await evaluate(`${card}.scrollIntoView({ block: 'center', behavior: 'instant' })`); await snapshot("ocr-approval.png", card);
  await click("仅本次", card);
  stage("approved Harness OCR, waiting for real local engine and metadata continuation");
  await waitFor(() => evaluate(`document.body.textContent.includes(${JSON.stringify(finalText)})`), "real Harness metadata continuation", 90_000);
  const ocrResult = (await hostCall("screen.results.list", { botId: bot.id })).results.find(result => result.mode === "ocr");
  assert(ocrResult, `Harness continued without a successfully published offline OCR result: ${JSON.stringify(bodies[1]?.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === "tool_result") : []))}`);
  const preview = await hostCall("screen.result.read", { botId: bot.id, id: ocrResult.id });
  assert(preview.text.toUpperCase().includes(syntheticText), "local OCR did not recognize the synthetic fixture");
  assert(preview.imageBase64.length <= 360000, "preview exceeded response boundary");
  assert(bodies.length === 2, "expected one tool request and one model continuation");
  const continuation = JSON.stringify(bodies[1]);
  const toolResults = bodies[1].messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === "tool_result") : []);
  assert(toolResults.length === 1, "expected exactly one tool result in continuation");
  const content = toolResults[0].content;
  const resultText = typeof content === "string" ? content : content.filter(block => block.type === "text").map(block => block.text).join("");
  const metadata = JSON.parse(resultText);
  assert(JSON.stringify(Object.keys(metadata).sort()) === JSON.stringify(["id", "mode", "at", "width", "height", "hasOcr"].sort()), "model result contains fields beyond screen metadata");
  assert(Object.keys(metadata).every(key => metadata[key] === ocrResult[key]), "model metadata differs from local result");
  assert(continuation.includes(ocrResult.id), "result metadata did not reach model");
  for (const forbidden of [preview.text, "HELLO LOCAL OCR 12345", preview.imageBase64, "screen-outputs", ownedWindow.title]) assert(!continuation.includes(forbidden), "local screen content leaked into model continuation");
  const audit = readFileSync(join(process.env.DEEPSEEK_BOT_DATA_ROOT, "logs", "agent-tools-audit.jsonl"), "utf8");
  assert(!audit.includes("HELLO LOCAL OCR 12345") && !audit.includes(ownedWindow.title) && !audit.includes(preview.imageBase64), "screen content leaked into audit");
  checkpoints.offlineOcrRecognized = true; checkpoints.modelReceivedMetadataOnly = true; checkpoints.auditContainsNoScreenContent = true;
  await evaluate("document.querySelector('[aria-label=\"打开设置\"]').click()");
  await click("权限", "document.querySelector('.settings-nav')");
  await waitFor(() => evaluate(`${scope}?.querySelectorAll('.screen-result').length === 2`), "two own results visible");
  await click("查看", `${scope}.querySelector('.screen-result')`);
  await waitFor(() => evaluate(`Boolean(${scope}.querySelector('.screen-ocr-text')?.textContent.toUpperCase().includes(${JSON.stringify(syntheticText)}))`), "recognized text preview");
  await evaluate(`${scope}.querySelector('.screen-preview').scrollIntoView({ block: 'end', behavior: 'instant' })`);
  await snapshot("ocr-preview.png", `${scope}.querySelector('.screen-preview')`);
  for (let i = 0; i < 2; i++) {
    await click("删除", `${scope}.querySelector('.screen-result')`);
    await click("确认删除", scope);
    await waitFor(() => evaluate(`${scope}.querySelectorAll('.screen-result').length === ${1 - i}`), "own result deleted in UI");
  }
  assert((await hostCall("screen.results.list", { botId: bot.id })).results.length === 0, "local result deletion failed");
  assert(publishedFiles(bot.id).length === 0 && pendingImages(bot.id).length === 0, "deleted result files remained");
  checkpoints.deletedOwnResults = true;
  stage("closed fixture is rejected without capturing another window");
  const closed = new Promise(done => fixture.once("exit", done)); fixture.kill(); await closed;
  await click("截图", scope); await approval(bot.id); await click("仅本次", card);
  await waitFor(async () => !(await hostCall("screen.status", { botId: bot.id })).busy, "closed-window request completed");
  assert((await hostCall("screen.results.list", { botId: bot.id })).results.length === 0 && publishedFiles(bot.id).length === 0 && pendingImages(bot.id).length === 0, "closed-window request published an artifact");
  checkpoints.closedWindowRejected = true;
  await evaluate(`${scope}.scrollIntoView({ block: 'end', behavior: 'instant' })`);
  stage("verified native capture, deny/cancel, local preview, offline OCR and model metadata boundary"); await finish();
}
app.on("browser-window-created", (_event, win) => {
  if (primaryWindow) return;
  primaryWindow = win; win.webContents.setBackgroundThrottling(false);
  win.webContents.once("did-finish-load", () => { void accept().catch(finish); });
});
// Enumeration verifies our exact native identity; it never reads screen pixels.
async function assertOwnedIdentity() {
  assert(fixture && fixture.exitCode === null, "owned fixture is no longer alive");
  const listed = await new Promise((done, reject) => execFile(powershell,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", join(repoRoot, "packages/host/dist/screen-assets/win32-capture.ps1"), "list"],
    { windowsHide: true, timeout: 15_000, maxBuffer: 1_000_000 }, (error, stdout) => {
      if (error) reject(error); else { try { done(JSON.parse(stdout)); } catch (parseError) { reject(parseError); } }
    }));
  const matches = listed.windows.filter(item => item.title === fixtureTitle);
  assert(listed.ok && matches.length === 1, "owned fixture must be uniquely visible in the interactive desktop");
  const match = matches[0];
  assert(match.pid === fixture.pid && match.hwnd === ownedWindow.hwnd && match.processStartTime === ownedWindow.processStartTime && !match.minimized && !match.protected, "native fixture identity or visibility changed");
}
async function start() {
  assert(process.platform === "win32", "native screen acceptance requires Windows");
  hostNodeVersion = await new Promise((done, reject) => execFile("node", ["--version"], { windowsHide: true, timeout: 5_000 }, (error, stdout) => error ? reject(error) : done(stdout.trim())));
  // Windows can allocate a fetch-blocked low port for listen(0). Use the
  // IANA dynamic/private range for this controlled provider, with bounded retry.
  for (let attempt = 0; attempt < 32; attempt++) {
    try {
      await new Promise((done, reject) => {
        const failed = error => { provider.off("listening", ready); reject(error); };
        const ready = () => { provider.off("error", failed); done(); };
        provider.once("error", failed); provider.once("listening", ready);
        provider.listen(randomInt(49152, 65536), "127.0.0.1");
      });
      break;
    } catch (error) { if (error.code !== "EADDRINUSE" || attempt === 31) throw error; }
  }
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${provider.address().port}`;
  // The repository fixture intentionally shows its own form. All production
  // capture/OCR helpers remain hidden and act only on this exact owned identity.
  fixture = spawn(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(__dirname, "screen-fixture.ps1"), "-Title", fixtureTitle], { windowsHide: false, stdio: ["ignore", "pipe", "pipe"] });
  ownedWindow = await new Promise((done, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("owned fixture startup timed out")), 20_000);
    fixture.once("error", reject); fixture.once("exit", () => reject(new Error("owned fixture exited before startup")));
    fixture.stdout.on("data", chunk => { output += chunk.toString(); if (output.includes("\n")) { clearTimeout(timer); try { done(JSON.parse(output.trim())); } catch (error) { reject(error); } } });
    fixture.stderr.on("data", chunk => { clearTimeout(timer); reject(new Error(String(chunk))); });
  });
  assert(ownedWindow.pid === fixture.pid && ownedWindow.title === fixtureTitle && /^\d+$/.test(ownedWindow.hwnd) && /^\d+$/.test(ownedWindow.processStartTime), "synthetic fixture identity mismatch");
  await assertOwnedIdentity();
  require(join(desktopRoot, "out", "main", "index.cjs"));
}
void start().catch(finish);
setTimeout(() => { void finish(new Error("overall acceptance deadline exceeded")); }, 240_000).unref();
