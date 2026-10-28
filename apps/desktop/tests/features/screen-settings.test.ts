// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenSettings } from "../../src/renderer/src/features/screen/screen-settings.js";
import {
  screenHostNotice,
  screenPreviewDataUrl,
} from "../../src/renderer/src/features/screen/screen-preview.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

const BOT_A = "22222222-2222-4222-8222-222222222222";
const BOT_B = "33333333-3333-4333-8333-333333333333";
const WINDOW_A = "44444444-4444-4444-8444-444444444444";
const WINDOW_B = "55555555-5555-4555-8555-555555555555";
const RESULT = "66666666-6666-4666-8666-666666666666";
const APPROVAL = "11111111-1111-4111-8111-111111111111";
const AT = "2026-10-27T01:02:03.000Z";
const JPEG = "/9j/4AAQSkZJRg==";

interface Call {
  method: string;
  payload: unknown;
}

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setLanguagePreference("zh");
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
  setLanguagePreference("zh");
});

function bot(id: string, name: string, archivedAt: string | null = null) {
  return {
    id,
    name,
    revision: id,
    instructions: "",
    modelProfileId: id,
    workspaceId: id,
    toolPolicyId: id,
    archivedAt,
  };
}

function screenStatus(overrides: Record<string, unknown> = {}) {
  return { supported: true, enabled: false, target: null, busy: false, ...overrides };
}

function screenResult(overrides: Record<string, unknown> = {}) {
  return {
    id: RESULT,
    mode: "ocr",
    at: AT,
    width: 32,
    height: 16,
    hasOcr: true,
    ...overrides,
  };
}

function screenApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: APPROVAL,
    invocationId: "77777777-7777-4777-8777-777777777777",
    callerId: `ui:${BOT_A}`,
    botId: BOT_A,
    sessionId: null,
    tool: "screen_capture",
    capabilities: ["screen.capture"],
    params: {
      mode: "ocr",
      selectionId: WINDOW_A,
      windowTitle: "<script>alert(1)</script>",
    },
    actionDigest: "ab".repeat(32),
    generation: 1,
    status: "pending",
    createdAt: AT,
    expiresAt: "2026-10-27T01:12:03.000Z",
    decidedAt: null,
    ...overrides,
  };
}

function install(handler: (method: string, payload: unknown) => unknown): Call[] {
  const calls: Call[] = [];
  window.deepseekBot = {
    host: {
      call: async (method: string, payload: unknown) => {
        calls.push({ method, payload });
        return handler(method, payload);
      },
    },
  } as unknown as Window["deepseekBot"];
  return calls;
}

async function renderPanel(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(ScreenSettings));
  });
  return container;
}

function button(container: ParentNode, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing button ${label}`);
  return found;
}

function selectByLabel(container: ParentNode, label: string): HTMLButtonElement {
  const select = container.querySelector(`[aria-label="${label}"]`);
  if (!(select instanceof HTMLButtonElement)) throw new Error(`missing select ${label}`);
  return select;
}

async function click(container: ParentNode, label: string): Promise<void> {
  await act(async () => {
    button(container, label).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function choose(container: ParentNode, label: string, value: string): Promise<void> {
  let option = document.querySelector<HTMLButtonElement>(
    `.custom-select-item[data-value="${value}"]`,
  );
  if (option === null) {
    await act(async () => {
      selectByLabel(container, label).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    option = document.querySelector<HTMLButtonElement>(
      `.custom-select-item[data-value="${value}"]`,
    );
  }
  if (!(option instanceof HTMLButtonElement))
    throw new Error(`missing option ${value} on ${label}`);
  const chosen = option;
  await act(async () => {
    chosen.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("screen preview guard", () => {
  it("accepts only a bounded JPEG data URL", () => {
    expect(screenPreviewDataUrl(JPEG)).toBe(`data:image/jpeg;base64,${JPEG}`);
    expect(screenPreviewDataUrl("https://example.test/a.jpg")).toBeNull();
    expect(screenPreviewDataUrl("/9j/<script>")).toBeNull();
    expect(screenPreviewDataUrl("")).toBeNull();
    expect(screenPreviewDataUrl(`/9j/${"A".repeat(360_000)}`)).toBeNull();
  });

  it("maps known host failures without copying the message into the notice", () => {
    expect(
      screenHostNotice(
        Object.assign(new Error("screen target changed"), { code: "UNAUTHORIZED_PATH" }),
      ).key,
    ).toBe("screen.targetChanged");
    expect(
      screenHostNotice(
        Object.assign(new Error("secret window title"), { code: "UNAUTHORIZED_PATH" }),
      ).key,
    ).toBe("screen.notApproved");
    expect(screenHostNotice(new Error("secret window title")).key).toBe("screen.failed");
    expect(screenHostNotice(new Error("secret window title")).params).toBeUndefined();
  });
});

describe("screen settings panel", () => {
  it("asks to enable screen.capture and does not offer always allow", async () => {
    let enabled = false;
    const calls = install((method, payload) => {
      if (method === "bot.list") {
        return { bots: [bot(BOT_A, "Alpha"), bot(BOT_B, "Archived", AT)] };
      }
      if (method === "screen.status") return screenStatus({ enabled });
      if (method === "screen.results.list") return { results: [] };
      if (method === "permission.policy.set") {
        enabled = (payload as { mode: string }).mode === "ask";
        return payload;
      }
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(selectByLabel(container, "目标窗口").disabled).toBe(false);
    });
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).not.toContain("Archived");
    expect(container.textContent).toContain("不能始终允许");
    expect(container.querySelector("[role='switch']")?.getAttribute("aria-checked")).toBe("false");
    expect(button(container, "截图").disabled).toBe(true);
    expect(button(container, "截图并识别").disabled).toBe(true);
    await act(async () => {
      container
        .querySelector("[role='switch']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        method: "permission.policy.set",
        payload: { capability: "screen.capture", mode: "ask" },
      });
    });
    expect(calls.some((call) => JSON.stringify(call.payload).includes('"allow"'))).toBe(false);
    expect(container.textContent).toContain("已保存：屏幕与窗口感知 → 每次询问");
  });

  it("refreshes windows and selects one title as text", async () => {
    let target: { id: string; title: string } | null = null;
    const calls = install((method, payload) => {
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha")] };
      if (method === "screen.status") return screenStatus({ enabled: true, target });
      if (method === "screen.results.list") return { results: [] };
      if (method === "screen.windows.list") {
        return {
          windows: [
            { id: WINDOW_A, title: "Notes <b>secret</b>" },
            { id: WINDOW_B, title: "Other" },
          ],
        };
      }
      if (method === "screen.target.set") {
        const id = (payload as { id: string | null }).id;
        target = id === WINDOW_A ? { id, title: "Notes <b>secret</b>" } : null;
        return screenStatus({ enabled: true, target });
      }
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(button(container, "刷新窗口").disabled).toBe(false);
    });
    await click(container, "刷新窗口");
    await vi.waitFor(() => {
      expect(container.textContent).toContain("已刷新窗口列表");
    });
    await act(async () => {
      selectByLabel(container, "目标窗口").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const title = document.querySelector<HTMLElement>(
      `.custom-select-item[data-value="${WINDOW_A}"]`,
    );
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe("Notes <b>secret</b>");
    expect(title?.querySelector("b")).toBeNull();
    await choose(container, "目标窗口", WINDOW_A);
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        method: "screen.target.set",
        payload: { botId: BOT_A, id: WINDOW_A },
      });
    });
    expect(calls).toContainEqual({ method: "screen.windows.list", payload: {} });
  });

  it("approves a capture only once and previews the thumbnail and OCR text locally", async () => {
    const capture = deferred<unknown>();
    const calls = install((method, payload) => {
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha")] };
      if (method === "screen.status") {
        return screenStatus({
          enabled: true,
          target: { id: WINDOW_A, title: "Notes" },
        });
      }
      if (method === "screen.results.list") return { results: [screenResult()] };
      if (method === "screen.request") return capture.promise;
      if (method === "permission.approval.list") return { approvals: [screenApproval()] };
      if (method === "permission.approval.decide") {
        return {
          approval: { ...screenApproval(), status: "consumed", decidedAt: AT },
          grants: [],
        };
      }
      if (method === "screen.result.read") {
        return {
          result: screenResult(),
          imageBase64: JPEG,
          text: "<img src=x onerror=alert(1)> 你好",
        };
      }
      throw new Error(`unexpected ${method} ${JSON.stringify(payload)}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(button(container, "截图并识别").disabled).toBe(false);
    });
    await click(container, "截图并识别");
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='screen-approval']")).not.toBeNull();
    });
    const card = container.querySelector("[data-testid='screen-approval']");
    if (card === null) throw new Error("missing approval");
    expect([...card.querySelectorAll("button")].map((item) => item.textContent)).toEqual([
      "仅本次",
      "拒绝",
    ]);
    expect(card.textContent).toContain("<script>alert(1)</script>");
    expect(card.querySelector("script")).toBeNull();
    await click(card, "仅本次");
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        method: "permission.approval.decide",
        payload: {
          approvalId: APPROVAL,
          expectedActionDigest: "ab".repeat(32),
          decision: "approved",
          scope: "once",
        },
      });
    });
    expect(calls.some((call) => JSON.stringify(call.payload).includes("session"))).toBe(false);
    expect(calls.some((call) => JSON.stringify(call.payload).includes("permanent"))).toBe(false);
    await act(async () => {
      capture.resolve(screenResult());
    });
    await vi.waitFor(() => {
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        `data:image/jpeg;base64,${JPEG}`,
      );
    });
    expect(container.querySelector("pre")?.textContent).toBe("<img src=x onerror=alert(1)> 你好");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("本机预览");
    expect(calls.some((call) => call.method === "chat.send")).toBe(false);
    expect(calls).toContainEqual({
      method: "screen.request",
      payload: { botId: BOT_A, mode: "ocr" },
    });
  });

  it("deletes a result only after confirmation", async () => {
    let results = [screenResult()];
    const calls = install((method, payload) => {
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha")] };
      if (method === "screen.status") {
        return screenStatus({ enabled: true, target: { id: WINDOW_A, title: "Notes" } });
      }
      if (method === "screen.results.list") return { results };
      if (method === "screen.result.delete") {
        results = [];
        return { deleted: true };
      }
      throw new Error(`unexpected ${method} ${JSON.stringify(payload)}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(button(container, "删除").disabled).toBe(false);
    });
    await click(container, "删除");
    expect(calls.some((call) => call.method === "screen.result.delete")).toBe(false);
    await click(container, "保留");
    expect(calls.some((call) => call.method === "screen.result.delete")).toBe(false);
    await click(container, "删除");
    await click(container, "确认删除");
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        method: "screen.result.delete",
        payload: { botId: BOT_A, id: RESULT },
      });
    });
    expect(container.textContent).toContain("已删除本机结果");
    expect(container.textContent).toContain("还没有结果");
  });

  it("drops a late preview when the bot changes", async () => {
    const read = deferred<unknown>();
    install((method, payload) => {
      const botId = (payload as { botId?: string }).botId;
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha"), bot(BOT_B, "Beta")] };
      if (method === "screen.status") {
        return screenStatus({
          enabled: true,
          target: { id: WINDOW_A, title: botId === BOT_A ? "Alpha window" : "Beta window" },
        });
      }
      if (method === "screen.results.list") {
        return { results: botId === BOT_A ? [screenResult()] : [] };
      }
      if (method === "screen.result.read") return read.promise;
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(button(container, "查看").disabled).toBe(false);
    });
    await click(container, "查看");
    await choose(container, "采集目标", BOT_B);
    await act(async () => {
      read.resolve({
        result: screenResult(),
        imageBase64: JPEG,
        text: "LATE-OCR-A",
      });
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Beta");
    });
    expect(container.textContent).not.toContain("LATE-OCR-A");
    expect(container.querySelector("img")).toBeNull();
  });

  it("drops a capture that finishes after the target window changes", async () => {
    const capture = deferred<unknown>();
    let target: { id: string; title: string } | null = { id: WINDOW_A, title: "First" };
    const calls = install((method) => {
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha")] };
      if (method === "screen.status") return screenStatus({ enabled: true, target });
      if (method === "screen.results.list") return { results: [] };
      if (method === "screen.windows.list") {
        return {
          windows: [
            { id: WINDOW_A, title: "First" },
            { id: WINDOW_B, title: "Second" },
          ],
        };
      }
      if (method === "screen.target.set") {
        target = { id: WINDOW_B, title: "Second" };
        return screenStatus({ enabled: true, target });
      }
      if (method === "screen.request") return capture.promise;
      if (method === "permission.approval.list") return { approvals: [] };
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(button(container, "刷新窗口").disabled).toBe(false);
    });
    await click(container, "刷新窗口");
    await vi.waitFor(() => {
      expect(container.textContent).toContain("已刷新窗口列表");
    });
    await act(async () => {
      selectByLabel(container, "目标窗口").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".custom-select-item").length).toBeGreaterThan(2);
    });
    await click(container, "截图");
    await vi.waitFor(() => {
      expect(calls.some((call) => call.method === "screen.request")).toBe(true);
    });
    await choose(container, "目标窗口", WINDOW_B);
    await act(async () => {
      capture.resolve(screenResult({ mode: "image", hasOcr: false, text: undefined }));
      await Promise.resolve();
    });
    expect(calls.some((call) => call.method === "screen.result.read")).toBe(false);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toContain("LATE-TARGET");
  });

  it("explains when this computer cannot capture and still saves the switch", async () => {
    const calls = install((method, payload) => {
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha")] };
      if (method === "screen.status") return screenStatus({ supported: false });
      if (method === "screen.results.list") return { results: [] };
      if (method === "permission.policy.set") return payload;
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("这台电脑不能采集窗口");
    });
    expect(button(container, "刷新窗口").disabled).toBe(true);
    expect(button(container, "截图").disabled).toBe(true);
    expect(selectByLabel(container, "目标窗口").disabled).toBe(true);
    await act(async () => {
      container
        .querySelector("[role='switch']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        method: "permission.policy.set",
        payload: { capability: "screen.capture", mode: "ask" },
      });
    });
  });

  it("cancels the in-flight capture and reports a busy host", async () => {
    const capture = deferred<unknown>();
    const calls = install((method) => {
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha")] };
      if (method === "screen.status") {
        return screenStatus({ enabled: true, target: { id: WINDOW_A, title: "Notes" } });
      }
      if (method === "screen.results.list") return { results: [] };
      if (method === "screen.request") return capture.promise;
      if (method === "permission.approval.list") return { approvals: [] };
      if (method === "screen.cancel") return { cancelled: true };
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(button(container, "截图").disabled).toBe(false);
    });
    await click(container, "截图");
    await vi.waitFor(() => {
      expect(button(container, "取消").disabled).toBe(false);
    });
    await click(container, "取消");
    await vi.waitFor(() => {
      expect(calls).toContainEqual({ method: "screen.cancel", payload: { botId: BOT_A } });
    });
    await act(async () => {
      capture.reject(
        Object.assign(new Error("screen capture was cancelled"), { code: "CANCELLED" }),
      );
      await Promise.resolve();
    });
  });

  it("shows a catalogue error when capture is rejected", async () => {
    install((method) => {
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha")] };
      if (method === "screen.status") {
        return screenStatus({ enabled: true, target: { id: WINDOW_A, title: "Notes" } });
      }
      if (method === "screen.results.list") return { results: [] };
      if (method === "screen.request") {
        throw Object.assign(new Error("screen capture is busy"), { code: "RATE_LIMITED" });
      }
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(button(container, "截图").disabled).toBe(false);
    });
    await click(container, "截图");
    await vi.waitFor(() => {
      expect(container.textContent).toContain("已有一次采集在进行");
    });
    expect(container.textContent).not.toContain("screen capture is busy");
  });

  it("refuses a preview that is not a JPEG", async () => {
    install((method) => {
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha")] };
      if (method === "screen.status") return screenStatus({ enabled: true });
      if (method === "screen.results.list") return { results: [screenResult()] };
      if (method === "screen.result.read") {
        return { result: screenResult(), imageBase64: "not-a-jpeg", text: "kept as text" };
      }
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(button(container, "查看").disabled).toBe(false);
    });
    await click(container, "查看");
    await vi.waitFor(() => {
      expect(container.textContent).toContain("预览无法显示");
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toBe("kept as text");
  });

  it("re-translates a stored load failure when the language changes", async () => {
    install((method) => {
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha")] };
      throw new Error("host down");
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("屏幕设置读取失败");
    });
    await act(async () => {
      setLanguagePreference("en");
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Failed to load screen settings");
    });
    expect(container.textContent).not.toContain("屏幕设置读取失败");
  });
});
