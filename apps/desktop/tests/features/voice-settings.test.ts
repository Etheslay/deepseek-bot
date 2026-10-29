// @vitest-environment jsdom
/**
 * Voice settings panel (D27): path validation, the pick-file channel shape,
 * and the save → voice.status refresh handshake.
 *
 * The panel may only talk to the two existing contract methods
 * (voice.config.get/set, voice.status) and the desktop pick dialog. The pick
 * channel takes the file KIND only — a path can never travel renderer → main
 * as a pick argument. A save that leaves transcription unusable is rolled
 * back to the previous configuration and explained inline, never silently
 * persisted.
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceStatus } from "@deepseek-bot/contracts";
import { VoiceSettingsPanel } from "../../src/renderer/src/features/settings/voice-settings.js";

const OLD_BIN = "C:\\tools\\whisper\\whisper-cli.exe";
const OLD_MODEL = "C:\\models\\ggml-base.bin";
const MISSING_BIN = "C:\\tools\\whisper\\missing.exe";

const READY: VoiceStatus = {
  transcribe: { available: true, reason: null },
  speak: { available: true, reason: null },
};

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

type HostCall = { method: string; payload: unknown };

/** A host mock whose voice.status answers from the saved configuration. */
function hostMock(options: {
  config: { whisperBin: string | null; whisperModel: string | null };
  /** Overrides the status answer for every call (test-seeded states). */
  status?: VoiceStatus;
}) {
  const calls: HostCall[] = [];
  let config = options.config;
  const call = async (method: string, payload: unknown): Promise<unknown> => {
    calls.push({ method, payload });
    if (method === "voice.config.get") return config;
    if (method === "voice.config.set") {
      config = payload as typeof config;
      return config;
    }
    if (method === "voice.status") {
      if (options.status !== undefined) return options.status;
      if (config.whisperBin === null) {
        return { transcribe: { available: false, reason: "whisper.cpp binary is not configured" }, speak: READY.speak };
      }
      if (config.whisperModel === null) {
        return { transcribe: { available: false, reason: "whisper.cpp model is not configured" }, speak: READY.speak };
      }
      if (config.whisperBin === MISSING_BIN) {
        return { transcribe: { available: false, reason: "whisper.cpp binary was not found" }, speak: READY.speak };
      }
      return READY;
    }
    throw new Error(`unexpected method ${method}`);
  };
  return { calls, call, get config(): typeof config { return config; } };
}

function bridgeMock(host: { call: (method: string, payload: unknown) => Promise<unknown> }, pickFile: unknown): Window["deepseekBot"] {
  return { voice: { pickFile }, host } as unknown as Window["deepseekBot"];
}

async function mountPanel(props: { onConfigSaved: () => void; onToast: (message: string) => void }): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(VoiceSettingsPanel, props));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function setInput(container: ParentNode, ariaLabel: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${ariaLabel}"]`);
  if (input === null) throw new Error(`missing input ${ariaLabel}`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickButton(container: ParentNode, ariaLabel: string): void {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);
  if (button === null) throw new Error(`missing button ${ariaLabel}`);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function clickSave(container: ParentNode): void {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "保存");
  if (button === undefined) throw new Error("missing save button");
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("voice settings panel", () => {
  it("requires both paths before saving anything", async () => {
    const host = hostMock({ config: { whisperBin: null, whisperModel: null } });
    window.deepseekBot = bridgeMock(host, vi.fn());
    const onConfigSaved = vi.fn();
    const container = await mountPanel({ onConfigSaved, onToast: vi.fn() });

    clickSave(container);

    const saves = host.calls.filter((call) => call.method === "voice.config.set");
    expect(saves).toEqual([]);
    expect(onConfigSaved).not.toHaveBeenCalled();
    expect(container.textContent).toContain("需要先选择 whisper 程序");
    expect(container.textContent).toContain("需要先选择 whisper 模型");
  });

  it("fills paths through the pick dialog — the argument is the kind, never a path", async () => {
    const host = hostMock({ config: { whisperBin: null, whisperModel: null } });
    const pickKinds: unknown[] = [];
    window.deepseekBot = bridgeMock(
      host,
      async (kind: unknown) => {
        pickKinds.push(kind);
        return kind === "bin"
          ? { ok: true, path: OLD_BIN }
          : { ok: true, path: OLD_MODEL };
      },
    );
    const onConfigSaved = vi.fn();
    const onToast = vi.fn();
    const container = await mountPanel({ onConfigSaved, onToast });

    clickButton(container, "选择 whisper 程序文件");
    await act(async () => {
      await Promise.resolve();
    });
    clickButton(container, "选择 whisper 模型文件");
    await act(async () => {
      await Promise.resolve();
    });
    expect(pickKinds).toEqual(["bin", "model"]);
    const bin = container.querySelector<HTMLInputElement>('input[aria-label="whisper 程序"]');
    const model = container.querySelector<HTMLInputElement>('input[aria-label="whisper 模型"]');
    expect(bin?.value).toBe(OLD_BIN);
    expect(model?.value).toBe(OLD_MODEL);

    clickSave(container);
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.calls).toContainEqual({
      method: "voice.config.set",
      payload: { whisperBin: OLD_BIN, whisperModel: OLD_MODEL },
    });
    expect(onConfigSaved).toHaveBeenCalledOnce();
    expect(onToast).toHaveBeenCalledWith("已保存语音配置");
    expect(container.textContent).toContain("已就绪，输入框麦克风可用");
  });

  it("keeps the draft when the dialog is cancelled", async () => {
    const host = hostMock({ config: { whisperBin: OLD_BIN, whisperModel: OLD_MODEL } });
    window.deepseekBot = bridgeMock(host, async () => ({ ok: false, code: "cancelled" }));
    const container = await mountPanel({ onConfigSaved: vi.fn(), onToast: vi.fn() });

    clickButton(container, "选择 whisper 程序文件");
    await act(async () => {
      await Promise.resolve();
    });

    const bin = container.querySelector<HTMLInputElement>('input[aria-label="whisper 程序"]');
    expect(bin?.value).toBe(OLD_BIN);
  });

  it("rolls an unusable path back and explains it inline, never saving silently", async () => {
    const host = hostMock({ config: { whisperBin: OLD_BIN, whisperModel: OLD_MODEL } });
    window.deepseekBot = bridgeMock(host, vi.fn());
    const onConfigSaved = vi.fn();
    const container = await mountPanel({ onConfigSaved, onToast: vi.fn() });

    setInput(container, "whisper 程序", MISSING_BIN);
    clickSave(container);
    await act(async () => {
      await Promise.resolve();
    });

    const sets = host.calls.filter((call) => call.method === "voice.config.set");
    expect(sets).toEqual([
      { method: "voice.config.set", payload: { whisperBin: MISSING_BIN, whisperModel: OLD_MODEL } },
      // Restored: the rejected path never persists.
      { method: "voice.config.set", payload: { whisperBin: OLD_BIN, whisperModel: OLD_MODEL } },
    ]);
    expect(host.calls.filter((call) => call.method === "voice.status")).toHaveLength(3);
    expect(onConfigSaved).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("whisper 程序文件不存在");
  });
});
