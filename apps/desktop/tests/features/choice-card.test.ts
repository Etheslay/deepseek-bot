// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChoiceCard, type ChoiceOption } from "../../src/renderer/src/features/questions/choice-card.js";

const OPTIONS: ChoiceOption[] = [
  { id: "A", label: "深度思考一个复杂问题" },
  { id: "B", label: "帮我起草一个工作流" },
];

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

async function renderCard(props: Record<string, unknown>): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(ChoiceCard, { question: "想先试哪种能力？", options: OPTIONS, ...props }));
  });
  return container;
}

function buttons(container: ParentNode): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")];
}

describe("choice card", () => {
  it("renders raw option labels and reports the chosen option without a prefix (U1)", async () => {
    const onChoose = vi.fn();
    const container = await renderCard({ onChoose });
    expect(container.textContent).toContain("深度思考一个复杂问题");
    expect(container.textContent).not.toContain("我选择");
    expect(container.textContent).not.toContain("：");
    await act(async () => {
      buttons(container).find((b) => b.textContent?.includes("深度思考"))!.click();
    });
    expect(onChoose).toHaveBeenCalledWith(OPTIONS[0]);
  });

  it("keeps its rows after answering: the picked row is marked, the card dims (U2)", async () => {
    const container = await renderCard({
      answered: "深度思考一个复杂问题",
      onChoose: vi.fn(),
    });
    // 2026-11: no collapse into a single ✓ line — the card keeps its state.
    expect(container.querySelector(".choice-card")?.classList.contains("is-answered")).toBe(true);
    const rows = buttons(container);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.disabled).toBe(true);
    }
    const chosen = container.querySelector(".choice-option.is-chosen");
    expect(chosen?.textContent).toContain("深度思考一个复杂问题");
    expect(chosen?.getAttribute("aria-current")).toBe("true");
    expect(container.querySelector(".choice-answered")).toBeNull();
  });

  it("does not mark any row when the answer came from the composer (U2b)", async () => {
    const container = await renderCard({
      answered: "git@gitee.com:someone/repo.git",
      onChoose: vi.fn(),
    });
    // A free-text answer is not an option the card offered, so no row may look
    // like the person picked it.
    expect(container.querySelector(".choice-option.is-chosen")).toBeNull();
    expect(container.textContent).not.toContain("git@gitee.com");
    expect(container.querySelector(".choice-card")?.classList.contains("is-answered")).toBe(true);
  });

  it("locks every row while disabled so a card can only be answered once (U3)", async () => {
    const onChoose = vi.fn();
    const container = await renderCard({ disabled: true, onChoose });
    const rows = buttons(container);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.disabled).toBe(true);
      expect(row.getAttribute("aria-disabled")).toBe("true");
    }
    await act(async () => {
      rows[0]!.click();
    });
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("renders the fallback row with its own key and marks it with choice-other", async () => {
    const onChoose = vi.fn();
    const container = await renderCard({
      fallback: { id: "✎", label: "其他，我说明" },
      onChoose,
    });
    const fallbackRow = buttons(container).at(-1)!;
    expect(fallbackRow.className).toContain("choice-other");
    expect(fallbackRow.textContent).toContain("其他，我说明");
    await act(async () => {
      fallbackRow.click();
    });
    expect(onChoose).toHaveBeenCalledWith({ id: "✎", label: "其他，我说明" });
  });

  it("greys out the rows and explains when the question closed", async () => {
    const onChoose = vi.fn();
    const container = await renderCard({ expired: true, onChoose });
    for (const row of buttons(container)) {
      expect(row.disabled).toBe(true);
    }
    expect(container.textContent).toContain("该问题已过期或已取消");
    await act(async () => {
      buttons(container)[0]!.click();
    });
    expect(onChoose).not.toHaveBeenCalled();
  });
});
