// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchSettings } from "../../src/renderer/src/features/search/search-settings.js";

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

function click(container: ParentNode, label: string): void {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
  if (button === undefined) throw new Error(`missing button ${label}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("SearXNG settings", () => {
  it("saves and clears the endpoint without contacting a search service", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    let saved: string | null = "http://127.0.0.1:8080/search";
    window.deepseekBot = {
      host: {
        call: async (method: string, payload: unknown) => {
          calls.push({ method, payload });
          if (method === "search.config.get") return { endpoint: saved };
          if (method === "search.config.set") {
            saved = (payload as { endpoint: string | null }).endpoint;
            return { endpoint: saved };
          }
          throw new Error(`unexpected method ${method}`);
        },
      },
    } as unknown as Window["deepseekBot"];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(createElement(SearchSettings));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const input = container.querySelector("input");
    if (input === null) throw new Error("missing endpoint input");
    expect(input.value).toBe("http://127.0.0.1:8080/search");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setValue?.call(input, "  http://127.0.0.1:9090/search  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      click(container, "保存");
    });
    expect(calls).toContainEqual({
      method: "search.config.set",
      payload: { endpoint: "http://127.0.0.1:9090/search" },
    });
    expect(container.textContent).toContain("已保存搜索地址");
    expect(calls.some((call) => call.method === "settings.testConnection")).toBe(false);
    await act(async () => {
      click(container, "清除");
    });
    expect(calls).toContainEqual({
      method: "search.config.set",
      payload: { endpoint: null },
    });
    expect(container.textContent).toContain("已清除搜索地址");
  });
});
