// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchResultCards } from "../../src/renderer/src/features/search/search-results.js";

const BOT = "22222222-2222-4222-8222-222222222222";
const TITLE = "<img src=x onerror=alert(1)>Private title";

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

async function renderCards(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(SearchResultCards, { botId: BOT }));
  });
  return container;
}

describe("web_search result cards", () => {
  it("shows titles as text and links only credential-free http(s) urls", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    window.deepseekBot = {
      host: {
        call: async (method: string, payload: unknown) => {
          calls.push({ method, payload });
          return {
            searches: [
              {
                query: "private research question",
                results: [
                  {
                    title: TITLE,
                    url: "https://example.org/report",
                    snippet: "Private snippet",
                  },
                  {
                    title: "Hidden",
                    url: "http://user:pass@example.org/secret",
                    snippet: "no link",
                  },
                ],
                warnings: [],
                at: "2026-10-26T08:00:00.000Z",
              },
            ],
          };
        },
      },
    } as unknown as Window["deepseekBot"];
    const container = await renderCards();
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls[0]).toEqual({ method: "search.results.list", payload: { botId: BOT } });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(TITLE);
    expect(container.textContent).toContain("Private snippet");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.org/report");
    expect(link?.getAttribute("rel")).toBe("noreferrer");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.textContent).toContain("http://user:pass@example.org/secret");
  });
});
