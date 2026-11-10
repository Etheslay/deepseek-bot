// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_SUCCESS_VISIBLE_MS,
  ConnectionTestNote,
  type ConnectionTestResult,
} from "../../src/renderer/src/features/settings/connection-test-note.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

setLanguagePreference("zh");

describe("ConnectionTestNote", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function render(result: ConnectionTestResult | null, onDismiss: () => void): void {
    act(() => {
      root.render(createElement(ConnectionTestNote, { result, onDismiss }));
    });
  }

  it("hides a successful connection after five seconds", () => {
    const onDismiss = vi.fn();
    render({ result: "success", ok: true }, onDismiss);
    expect(container.textContent).toContain("连接成功");

    act(() => {
      vi.advanceTimersByTime(CONNECTION_SUCCESS_VISIBLE_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(container.textContent).toContain("连接成功");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps a failed connection on screen", () => {
    const onDismiss = vi.fn();
    render({ result: "failure", ok: false, errorCode: "AUTH_FAILED" }, onDismiss);

    act(() => {
      vi.advanceTimersByTime(CONNECTION_SUCCESS_VISIBLE_MS + 1_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(container.textContent).toContain("AUTH_FAILED");
  });
});
