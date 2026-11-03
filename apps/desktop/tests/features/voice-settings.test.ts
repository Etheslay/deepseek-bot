// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceSettingsPanel } from "../../src/renderer/src/features/settings/voice-settings.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

const roots: Root[] = [];

async function mount(props?: {
  onConfigSaved?: () => void;
  onToast?: (message: string) => void;
}): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(VoiceSettingsPanel, {
        onConfigSaved: props?.onConfigSaved ?? vi.fn(),
        onToast: props?.onToast ?? vi.fn(),
      }),
    );
  });
  return host;
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  document.body.textContent = "";
  setLanguagePreference("zh");
  delete (window as { deepseekBot?: unknown }).deepseekBot;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  delete (window as { deepseekBot?: unknown }).deepseekBot;
});

describe("VoiceSettingsPanel", () => {
  it("shows the unavailable message when the desktop bridge is missing", async () => {
    const host = await mount();
    expect(host.textContent).toContain("本机语音转写不可用");
    expect(host.textContent).toContain("设置 → 语音");
    expect(host.querySelector("[data-testid='voice-settings']")).toBeNull();
  });

  it("does not save when either path is empty", async () => {
    const call = vi.fn(async () => ({}));
    window.deepseekBot = {
      voice: { pickFile: vi.fn() },
      host: { call },
    } as unknown as Window["deepseekBot"];
    const host = await mount();
    const save = [...host.querySelectorAll("button")].find((button) => button.textContent === "保存");
    await act(async () => {
      save?.click();
    });
    expect(host.textContent).toContain("需要先填写 whisper 程序路径");
    expect(host.textContent).toContain("需要先填写 whisper 模型路径");
    expect(call).not.toHaveBeenCalledWith("voice.config.set", expect.anything());
  });

  it("saves both paths and then asks for status", async () => {
    const calls: string[] = [];
    const call = vi.fn(async (method: string, payload: unknown) => {
      calls.push(method);
      if (method === "voice.config.get") return { whisperBin: null, whisperModel: null };
      if (method === "voice.config.set") return payload;
      if (method === "voice.status") {
        return {
          transcribe: { available: true, reason: null },
          speak: { available: false, reason: "Windows SAPI is only available on Windows" },
        };
      }
      throw new Error(method);
    });
    window.deepseekBot = {
      voice: { pickFile: vi.fn() },
      host: { call },
    } as unknown as Window["deepseekBot"];
    const onConfigSaved = vi.fn();
    const onToast = vi.fn();
    const host = await mount({ onConfigSaved, onToast });
    const inputs = [...host.querySelectorAll("input")];
    await act(async () => {
      setInput(inputs[0]!, "C:\\whisper\\whisper-cli.exe");
      setInput(inputs[1]!, "C:\\whisper\\ggml-small.bin");
    });
    const save = [...host.querySelectorAll("button")].find((button) => button.textContent === "保存");
    await act(async () => {
      save?.click();
    });
    expect(call).toHaveBeenCalledWith("voice.config.set", {
      whisperBin: "C:\\whisper\\whisper-cli.exe",
      whisperModel: "C:\\whisper\\ggml-small.bin",
    });
    const setIndex = calls.indexOf("voice.config.set");
    expect(calls.indexOf("voice.status", setIndex + 1)).toBeGreaterThan(setIndex);
    expect(onConfigSaved).toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith("已保存语音配置");
  });
});
