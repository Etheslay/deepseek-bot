// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorSettings } from "../../src/renderer/src/features/connectors/connector-settings.js";

const ID = "33333333-3333-4333-8333-333333333333";
const NAME = "<img src=x onerror=alert(1)>drawer";
const REF = "cred:11111111-1111-4111-8111-111111111111";

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
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (button === undefined) throw new Error(`missing button ${label}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("connector settings", () => {
  it("lists, registers, enables and disables without calling a connector", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    let connectors: Array<{
      id: string;
      name: string;
      enabled: boolean;
      credentialRef: string | null;
      at: string;
      updatedAt: string;
    }> = [
      {
        id: ID,
        name: NAME,
        enabled: false,
        credentialRef: null,
        at: "2026-10-26T12:00:00.000Z",
        updatedAt: "2026-10-26T12:00:00.000Z",
      },
    ];
    window.deepseekBot = {
      host: {
        call: async (method: string, payload: unknown) => {
          calls.push({ method, payload });
          if (method === "connector.list") return { connectors };
          if (method === "connector.register") {
            const body = payload as { name: string; credentialRef?: string };
            connectors = [
              {
                id: ID,
                name: body.name,
                enabled: false,
                credentialRef: body.credentialRef ?? null,
                at: "2026-10-26T12:01:00.000Z",
                updatedAt: "2026-10-26T12:01:00.000Z",
              },
            ];
            return connectors[0];
          }
          if (method === "connector.enable") {
            connectors = connectors.map((row) => ({ ...row, enabled: true }));
            return connectors[0];
          }
          if (method === "connector.disable") {
            connectors = connectors.map((row) => ({ ...row, enabled: false }));
            return connectors[0];
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
      root.render(createElement(ConnectorSettings));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toContainEqual({ method: "connector.list", payload: {} });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(NAME);
    expect(container.textContent).toContain("已关闭");
    await act(async () => {
      click(container, "启用");
    });
    expect(calls).toContainEqual({ method: "connector.enable", payload: { id: ID } });
    expect(container.textContent).toContain("已启用");
    await act(async () => {
      click(container, "停用");
    });
    expect(calls).toContainEqual({ method: "connector.disable", payload: { id: ID } });
    expect(container.textContent).toContain("已关闭");

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const name = container.querySelector('input[aria-label="连接器名称"]');
    const ref = container.querySelector('input[aria-label="凭据引用"]');
    if (!(name instanceof HTMLInputElement) || !(ref instanceof HTMLInputElement)) {
      throw new Error("missing connector inputs");
    }
    await act(async () => {
      setValue?.call(name, "  local drawer  ");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      setValue?.call(ref, `  ${REF}  `);
      ref.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      click(container, "注册");
    });
    expect(calls).toContainEqual({
      method: "connector.register",
      payload: { name: "local drawer", credentialRef: REF },
    });
    expect(container.textContent).toContain("已登记连接器");
    expect(calls.every((call) => !String(call.method).includes("invoke"))).toBe(true);
  });

  it("omits a blank credential reference and reports a rejected registration", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    window.deepseekBot = {
      host: {
        call: async (method: string, payload: unknown) => {
          calls.push({ method, payload });
          if (method === "connector.list") return { connectors: [] };
          if (method === "connector.register") {
            const body = payload as { credentialRef?: string };
            if (body.credentialRef === "sk-live-secret") throw new Error("rejected");
            return {
              id: ID,
              name: "bare",
              enabled: false,
              credentialRef: null,
              at: "2026-10-26T12:00:00.000Z",
              updatedAt: "2026-10-26T12:00:00.000Z",
            };
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
      root.render(createElement(ConnectorSettings));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const name = container.querySelector('input[aria-label="连接器名称"]');
    if (!(name instanceof HTMLInputElement)) throw new Error("missing name");
    await act(async () => {
      setValue?.call(name, "bare");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      click(container, "注册");
    });
    expect(calls).toContainEqual({ method: "connector.register", payload: { name: "bare" } });
    const ref = container.querySelector('input[aria-label="凭据引用"]');
    if (!(ref instanceof HTMLInputElement)) throw new Error("missing ref");
    await act(async () => {
      setValue?.call(name, "leak");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      setValue?.call(ref, "sk-live-secret");
      ref.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      click(container, "注册");
    });
    expect(container.textContent).toContain("连接器注册失败");
    expect(calls.filter((call) => call.method === "connector.register")).toHaveLength(2);
  });
});
