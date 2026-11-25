// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveredFileCard } from "../../src/renderer/src/features/chat/delivered-file.js";
import { historyThreadMessages } from "../../src/renderer/src/features/chat/thread-history.js";
import { fetchDeliveredBytes } from "../../src/renderer/src/services/delivered-bytes.js";
import type { ChatHistoryRow } from "../../src/renderer/src/services/desktop-service.js";
import type { DeliveredFile } from "@deepseek-bot/contracts";

const FILE: DeliveredFile = {
  path: "attachments/xiaoxue-chengfa.pptx",
  name: "xiaoxue-chengfa.pptx",
  bytes: 13,
  format: "pptx",
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
});

describe("DeliveredFileCard", () => {
  it("opens from the card and downloads from the separate button", async () => {
    const onView = vi.fn();
    const onDownload = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(createElement(DeliveredFileCard, { file: FILE, onView, onDownload }));
    });
    const view = container.querySelector(".delivered-view");
    const download = container.querySelector(".delivered-download");
    expect(view?.textContent).toContain("xiaoxue-chengfa.pptx");
    expect(container.querySelector(".file-card")?.getAttribute("data-tone")).toBe("ppt");
    view?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    download?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onView).toHaveBeenCalledOnce();
    expect(onDownload).toHaveBeenCalledOnce();
  });
});

describe("fetchDeliveredBytes", () => {
  it("stitches slices until the card size is filled", async () => {
    const call = vi.fn(async (_method: string, payload: unknown) => {
      const offset = (payload as { offset: number }).offset;
      const chunk = offset === 0 ? "PK-h" : "ello-pptx";
      return {
        size: 12,
        mediaType: "application/octet-stream",
        data: btoa(chunk),
      };
    });
    const bytes = await fetchDeliveredBytes(call, "11111111-1111-4111-8111-111111111111", {
      path: FILE.path,
      bytes: 13,
    });
    expect(new TextDecoder().decode(bytes)).toBe("PK-hello-pptx");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("refuses a short file", async () => {
    let calls = 0;
    const call = vi.fn(async () => {
      calls += 1;
      return {
        size: 2,
        mediaType: "application/octet-stream",
        data: calls === 1 ? btoa("PK") : "",
      };
    });
    await expect(
      fetchDeliveredBytes(call, "11111111-1111-4111-8111-111111111111", {
        path: FILE.path,
        bytes: 12,
      }),
    ).rejects.toThrow(/length/);
  });
});

describe("history of a delivered file", () => {
  it("keeps the card on the assistant row and still drops a dispatch row", () => {
    const row = (partial: {
      id: string;
      text: string;
      meta?: ChatHistoryRow["meta"];
    }): ChatHistoryRow => ({
      id: partial.id,
      botId: "11111111-1111-4111-8111-111111111111",
      sessionId: "chat:11111111-1111-4111-8111-111111111111",
      role: "assistant",
      text: partial.text,
      at: "2026-10-28T00:00:02.000Z",
      ...(partial.meta !== undefined ? { meta: partial.meta } : {}),
    });
    const messages = historyThreadMessages(
      [
        row({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          text: "做好了",
          meta: { kind: "files", files: [FILE] },
        }),
        row({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          text: "delegated",
          meta: {
            kind: "dispatch",
            taskId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            fromBotId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          },
        }),
      ],
      4,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.files).toEqual([FILE]);
    expect(messages[0]?.text).toBe("做好了");
  });
});
