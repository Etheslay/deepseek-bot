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

const BOT2 = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const AT = "2026-10-26T12:00:00.000Z";

async function edit(container: ParentNode, label: string, value: string): Promise<void> {
  const input = container.querySelector(`[aria-label="${label}"]`);
  if (input instanceof HTMLInputElement) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return;
  }
  // The dropdowns are the app's own control now (a native <select> cannot drop
  // the Windows selection wash), so pick the option by its value.
  if (input instanceof HTMLButtonElement) {
    await act(async () => {
      input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // The menu is portaled to document.body (viewport-flip fix); only one
    // select menu is open at a time.
    const option = document.querySelector<HTMLButtonElement>(
      `.custom-select-item[data-value="${value}"]`,
    );
    if (!(option instanceof HTMLButtonElement)) {
      throw new Error(`missing option ${value} on ${label}`);
    }
    await act(async () => {
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    return;
  }
  throw new Error(`missing control ${label}`);
}

async function mountMcp(override?: (method: string, payload: unknown) => unknown): Promise<{
  container: HTMLDivElement;
  calls: Array<{ method: string; payload: unknown }>;
}> {
  const calls: Array<{ method: string; payload: unknown }> = [];
  window.deepseekBot = {
    host: {
      call: async (method: string, payload: unknown) => {
        calls.push({ method, payload });
        const result = override?.(method, payload);
        if (result !== undefined) return result;
        if (method === "connector.list")
          return {
            connectors: [ID, OTHER].map((id) => ({
              id,
              name: id === ID ? "MCP One" : "MCP Two",
              kind: "mcp-http",
              enabled: true,
              credentialRef: null,
              endpoint: "http://127.0.0.1:8080/mcp",
              at: AT,
              updatedAt: AT,
            })),
          };
        if (method === "bot.list")
          return {
            bots: [ID, BOT2].map((id) => ({
              id,
              name: id === ID ? "Bot One" : "Bot Two",
              revision: ID,
              instructions: "",
              modelProfileId: ID,
              workspaceId: ID,
              toolPolicyId: ID,
              archivedAt: null,
            })),
          };
        if (method === "connector.mcp.grants.get" || method === "connector.mcp.grants.set")
          return { servers: [] };
        if (method === "connector.mcp.discover")
          return { tools: ["read", "write"].map((name) => ({ name, inputSchema: {} })), at: AT };
        if (method === "connector.register") return {};
        throw new Error(`unexpected ${method}`);
      },
    },
  } as unknown as Window["deepseekBot"];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(createElement(ConnectorSettings)));
  return { container, calls };
}

describe("MCP settings", () => {
  it("clears a leftover credential when the kind changes, then sends one typed for MCP", async () => {
    const { container, calls } = await mountMcp();
    await edit(container, "凭据引用", REF);
    await edit(container, "连接器类型", "mcp-http");
    expect((container.querySelector('[aria-label="凭据引用"]') as HTMLInputElement).value).toBe("");
    await edit(container, "连接器名称", "MCP");
    await edit(container, "连接器端点", "http://127.0.0.1:8080/mcp");
    await act(async () => click(container, "注册"));
    expect(calls).toContainEqual({
      method: "connector.register",
      payload: {
        name: "MCP",
        kind: "mcp-http",
        endpoint: "http://127.0.0.1:8080/mcp",
      },
    });
    await edit(container, "连接器类型", "mcp-http");
    await edit(container, "凭据引用", REF);
    await edit(container, "连接器名称", "MCP token");
    await edit(container, "连接器端点", "http://127.0.0.1:8080/mcp");
    await act(async () => click(container, "注册"));
    expect(calls).toContainEqual({
      method: "connector.register",
      payload: {
        name: "MCP token",
        kind: "mcp-http",
        credentialRef: REF,
        endpoint: "http://127.0.0.1:8080/mcp",
      },
    });
  });

  it("registers a stdio command without an HTTP endpoint", async () => {
    const { container, calls } = await mountMcp();
    await edit(container, "连接器类型", "mcp-stdio");
    expect(container.querySelector('[aria-label="连接器端点"]')).toBeNull();
    await edit(container, "连接器名称", "stdio");
    await edit(container, "本地命令", "server");
    await edit(container, "启动参数", '["--stdio"]');
    await edit(container, "凭据引用", REF);
    await act(async () => click(container, "注册"));
    expect(calls).toContainEqual({
      method: "connector.register",
      payload: {
        name: "stdio",
        kind: "mcp-stdio",
        command: "server",
        args: ["--stdio"],
        credentialRef: REF,
      },
    });
  });

  it("discovers only on request and saves exactly one checked tool per bot", async () => {
    const { container, calls } = await mountMcp();
    expect(calls.some(({ method }) => method === "connector.mcp.discover")).toBe(false);
    await act(async () => click(container, "发现工具"));
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0);
    await act(async () =>
      (container.querySelector('[aria-label="允许工具 read"]') as HTMLInputElement).click(),
    );
    await act(async () => click(container, "保存工具白名单"));
    expect(calls).toContainEqual({
      method: "connector.mcp.grants.set",
      payload: { botId: ID, id: ID, allowedTools: ["read"] },
    });
    await edit(container, "MCP 机器人", BOT2);
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0);
    await act(async () => click(container, "清空工具白名单"));
    expect(calls).toContainEqual({
      method: "connector.mcp.grants.set",
      payload: { botId: BOT2, id: ID, allowedTools: [] },
    });
    expect(container.textContent).not.toContain("每次 MCP 调用都需要单次审批");
  });

  it("keeps unavailable saved tools until explicitly removed", async () => {
    const { container, calls } = await mountMcp((method) =>
      method === "connector.mcp.grants.get"
        ? { servers: [{ serverId: ID, allowedTools: ["old"] }] }
        : undefined,
    );
    await act(async () => click(container, "发现工具"));
    expect(container.textContent).toContain("未在本次发现中提供");
    await act(async () => click(container, "保存工具白名单"));
    expect(calls).toContainEqual({
      method: "connector.mcp.grants.set",
      payload: { botId: ID, id: ID, allowedTools: ["old"] },
    });
  });

  it("reports discovery and save errors without granting anything", async () => {
    const { container } = await mountMcp((method) => {
      if (method === "connector.mcp.discover" || method === "connector.mcp.grants.set")
        return Promise.reject(new Error("disconnected"));
      return undefined;
    });
    await act(async () => click(container, "发现工具"));
    expect(container.textContent).toContain("工具发现失败");
    await act(async () => click(container, "清空工具白名单"));
    expect(container.textContent).toContain("工具白名单保存失败");
  });

  it("ignores discovery results after switching servers", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    const { container } = await mountMcp((method) =>
      method === "connector.mcp.discover" ? pending : undefined,
    );
    await act(async () => click(container, "发现工具"));
    await edit(container, "MCP 服务", OTHER);
    await act(async () => resolve({ tools: [{ name: "stale", inputSchema: {} }], at: AT }));
    expect(container.textContent).not.toContain("stale");
  });

  it("loads each bot's saved grants and ignores a late grant response", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    let first = true;
    const { container } = await mountMcp((method, payload) => {
      if (method !== "connector.mcp.grants.get") return undefined;
      if ((payload as { botId: string }).botId === ID && first) {
        first = false;
        return pending;
      }
      return {
        servers: [
          {
            serverId: ID,
            allowedTools: [(payload as { botId: string }).botId === ID ? "read" : "write"],
          },
        ],
      };
    });
    await edit(container, "MCP 机器人", BOT2);
    await act(async () => resolve({ servers: [{ serverId: ID, allowedTools: ["stale"] }] }));
    expect(container.textContent).toContain("write");
    expect(container.textContent).not.toContain("stale");
    await edit(container, "MCP 机器人", ID);
    expect(
      (container.querySelector('[aria-label="允许工具 read"]') as HTMLInputElement).checked,
    ).toBe(true);
    expect(container.querySelector('[aria-label="允许工具 write"]')).toBeNull();
  });

  it("reports empty tools and prevents discovery of disabled services", async () => {
    const { container, calls } = await mountMcp((method) => {
      if (method === "connector.list")
        return {
          connectors: [
            {
              id: ID,
              name: "Stopped",
              kind: "mcp-http",
              enabled: false,
              credentialRef: null,
              endpoint: "http://127.0.0.1:8080/mcp",
              at: AT,
              updatedAt: AT,
            },
          ],
        };
      return undefined;
    });
    const discover = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "发现工具",
    );
    expect(discover?.disabled).toBe(true);
    expect(container.textContent).toContain("服务已停用");
    expect(calls.some(({ method }) => method === "connector.mcp.discover")).toBe(false);
    const enabled = await mountMcp((method) =>
      method === "connector.mcp.discover" ? { tools: [], at: AT } : undefined,
    );
    await act(async () => click(enabled.container, "发现工具"));
    expect(enabled.container.textContent).toContain("服务未返回可用工具");
  });

  it("disables grant writes when existing authorization cannot be read", async () => {
    const { container, calls } = await mountMcp((method) =>
      method === "connector.mcp.grants.get" ? Promise.reject(new Error("read failed")) : undefined,
    );
    expect(container.textContent).toContain("工具白名单读取失败");
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "保存工具白名单",
    );
    expect(save?.disabled).toBe(true);
    expect(calls.some(({ method }) => method === "connector.mcp.grants.set")).toBe(false);
  });
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
      endpoint: string | null;
      at: string;
      updatedAt: string;
    }> = [
      {
        id: ID,
        name: NAME,
        enabled: false,
        credentialRef: null,
        endpoint: null,
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
            const body = payload as { name: string; credentialRef?: string; endpoint?: string };
            connectors = [
              {
                id: ID,
                name: body.name,
                enabled: false,
                credentialRef: body.credentialRef ?? null,
                endpoint: body.endpoint ?? null,
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
