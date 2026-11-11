/**
 * Tool policy evaluator + action digest tests (D08).
 * Pure decision matrix over pinned policy/workspace inputs (QA-08 data).
 */
import { describe, expect, it } from "vitest";
import type { ToolPolicy, Workspace } from "@deepseek-bot/contracts";
import { computeActionDigest, stableStringify } from "./permissions/actions.js";
import { evaluateToolAction, toolActionResource } from "./permissions/policy.js";

function makePolicy(overrides: Partial<ToolPolicy> = {}): ToolPolicy {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    revision: "67676767-6767-4676-8767-676767676767",
    name: "评估测试策略",
    filesystem: { enabled: true, operations: ["read", "write"] },
    shell: { mode: "disabled" },
    network: { mode: "disabled" },
    mcp: { enabled: false, requireApproval: false, servers: [] },
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    canonicalPath: "C:\\workspaces\\demo",
    grants: [{ scopePath: "C:\\workspaces\\demo", operations: ["read", "write"] }],
    ...overrides,
  };
}

const BASE = () => ({ policy: makePolicy(), workspace: makeWorkspace(), artifactsRoot: undefined });

describe("filesystem decisions", () => {
  it.skipIf(process.platform !== "win32")("allows reads and writes inside granted scopes", () => {
    const decision = evaluateToolAction(
      { kind: "file.write", callId: "c1", toolName: "fs.write", path: "C:\\workspaces\\demo\\out.txt" },
      "C:\\workspaces\\demo\\out.txt",
      BASE(),
    );
    expect(decision).toEqual({ effect: "allow", resource: "C:\\workspaces\\demo\\out.txt" });
  });

  it("denies operations the grant does not carry", () => {
    const input = { policy: makePolicy({ filesystem: { enabled: true, operations: ["read"] } }), workspace: makeWorkspace(), artifactsRoot: undefined };
    expect(
      evaluateToolAction(
        { kind: "file.write", callId: "c1", toolName: "fs.write", path: "C:\\workspaces\\demo\\out.txt" },
        "C:\\workspaces\\demo\\out.txt",
        input,
      ),
    ).toMatchObject({ effect: "deny", code: "UNAUTHORIZED_PATH" });
  });

  it("denies paths outside every grant (boundary aware)", () => {
    for (const path of ["C:\\workspaces\\demo-other\\x", "C:\\elsewhere\\x"]) {
      const decision = evaluateToolAction(
        { kind: "file.read", callId: "c1", toolName: "fs.read", path },
        path,
        BASE(),
      );
      expect(decision.effect).toBe("deny");
    }
  });

  it("denies filesystem access when disabled or unresolvable", () => {
    const disabled = { policy: makePolicy({ filesystem: { enabled: false, operations: [] } }), workspace: makeWorkspace(), artifactsRoot: undefined };
    expect(
      evaluateToolAction(
        { kind: "file.read", callId: "c", toolName: "fs", path: "C:\\workspaces\\demo\\a" },
        "C:\\workspaces\\demo\\a",
        disabled,
      ).effect,
    ).toBe("deny");

    const noWorkspace = { policy: makePolicy(), workspace: undefined, artifactsRoot: undefined };
    expect(
      evaluateToolAction(
        { kind: "file.read", callId: "c", toolName: "fs", path: "C:\\workspaces\\demo\\a" },
        "C:\\workspaces\\demo\\a",
        noWorkspace,
      ).effect,
    ).toBe("deny");
  });

  it.skipIf(process.platform !== "win32")("grants the artifact directory read/write and routes deletion to approval", () => {
    const input = { ...BASE(), artifactsRoot: "C:\\workspaces\\demo\\.artifacts" };
    const write = evaluateToolAction(
      { kind: "file.write", callId: "c", toolName: "fs", path: "C:\\workspaces\\demo\\.artifacts\\r\\o.txt" },
      "C:\\workspaces\\demo\\.artifacts\\r\\o.txt",
      input,
    );
    expect(write.effect).toBe("allow");

    const del = evaluateToolAction(
      { kind: "file.delete", callId: "c", toolName: "fs", path: "C:\\workspaces\\demo\\keep.txt" },
      "C:\\workspaces\\demo\\keep.txt",
      BASE(),
    );
    expect(del.effect).toBe("approval-required");
  });

  it("requires a canonical path for file actions", () => {
    expect(
      evaluateToolAction(
        { kind: "file.read", callId: "c", toolName: "fs" },
        undefined,
        BASE(),
      ),
    ).toMatchObject({ effect: "deny", code: "INVALID_INPUT" });
  });
});

describe("shell, network and MCP decisions", () => {
  it("denies disabled shell and always routes enabled shell through approval", () => {
    expect(
      evaluateToolAction({ kind: "shell.exec", callId: "c", toolName: "sh", command: "dir" }, undefined, BASE()).effect,
    ).toBe("deny");
    const shellOn = { ...BASE(), policy: makePolicy({ shell: { mode: "approval-required" } }) };
    const decision = evaluateToolAction(
      { kind: "shell.exec", callId: "c", toolName: "sh", command: "del C:\\x" },
      undefined,
      shellOn,
    );
    expect(decision.effect).toBe("approval-required");
    expect(
      evaluateToolAction({ kind: "shell.exec", callId: "c", toolName: "sh" }, undefined, shellOn),
    ).toMatchObject({ effect: "deny", code: "INVALID_INPUT" });
  });

  it("honors the three network modes", () => {
    const net = (mode: ToolPolicy["network"]["mode"]) => ({
      ...BASE(),
      policy: makePolicy({ network: { mode } }),
    });
    expect(
      evaluateToolAction({ kind: "network.request", callId: "c", toolName: "http", url: "https://a.example" }, undefined, net("disabled")).effect,
    ).toBe("deny");
    expect(
      evaluateToolAction({ kind: "network.request", callId: "c", toolName: "http", url: "https://a.example" }, undefined, net("approval-required")).effect,
    ).toBe("approval-required");
    expect(
      evaluateToolAction({ kind: "network.request", callId: "c", toolName: "http", url: "https://a.example" }, undefined, net("allowed")).effect,
    ).toBe("allow");
    expect(
      evaluateToolAction({ kind: "network.request", callId: "c", toolName: "http", url: "" }, undefined, net("allowed")),
    ).toMatchObject({ effect: "deny", code: "INVALID_INPUT" });
  });

  it("requires MCP server and tool identities", () => {
    const mcp = { ...BASE(), policy: makePolicy({ mcp: { enabled: true, requireApproval: false, servers: [] } }) };
    expect(
      evaluateToolAction({ kind: "mcp.call", callId: "c", toolName: "mcp" }, undefined, mcp),
    ).toMatchObject({ effect: "deny", code: "INVALID_INPUT" });
  });

  it("authorizes only allowlisted MCP servers and tools", () => {
    const mcp = { ...BASE(), policy: makePolicy({ mcp: { enabled: true, requireApproval: false, servers: [{ serverId: "fs", allowedTools: ["list_files"] }] } }) };
    const call = { kind: "mcp.call" as const, callId: "c", toolName: "mcp", mcpServerId: "fs", mcpToolName: "list_files" };
    expect(evaluateToolAction(call, undefined, mcp)).toEqual({
      effect: "allow",
      resource: "mcp://fs/list_files",
    });

    const unlistedTool = { ...call, mcpToolName: "delete_all" };
    expect(evaluateToolAction(unlistedTool, undefined, mcp).effect).toBe("deny");

    const unlistedServer = { ...call, mcpServerId: "unknown" };
    expect(evaluateToolAction(unlistedServer, undefined, mcp).effect).toBe("deny");

    const approvalMode = {
      ...mcp,
      policy: makePolicy({ mcp: { enabled: true, requireApproval: true, servers: [{ serverId: "fs", allowedTools: ["list_files"] }] } }),
    };
    expect(evaluateToolAction(call, undefined, approvalMode).effect).toBe("approval-required");
    expect(
      evaluateToolAction(call, undefined, { ...BASE(), policy: makePolicy() }).effect,
    ).toBe("deny");
  });
});

describe("action digest (QA-07 parameter binding)", () => {
  it("is stable across key order and sensitive to argument changes", () => {
    const base = {
      runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      nodeRunId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      kind: "file.write" as const,
      toolName: "fs",
      resource: "C:\\workspaces\\demo\\out.txt",
    };
    const a = computeActionDigest({ ...base, args: { path: "x", mode: "w" } });
    const b = computeActionDigest({ ...base, args: { mode: "w", path: "x" } });
    const c = computeActionDigest({ ...base, args: { path: "y", mode: "w" } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stringifies deterministically including nested values", () => {
    expect(stableStringify({ b: 1, a: [2, { z: 3, y: 4 }] })).toBe('{"a":[2,{"y":4,"z":3}],"b":1}');
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify("文本")).toBe('"文本"');
  });

  it("derives exact resources per action kind", () => {
    expect(toolActionResource({ kind: "file.write", callId: "c", toolName: "t", path: "C:\\x" }, "C:\\x")).toBe("C:\\x");
    expect(toolActionResource({ kind: "shell.exec", callId: "c", toolName: "t", command: "dir" }, undefined)).toBe("dir");
    expect(toolActionResource({ kind: "network.request", callId: "c", toolName: "t", url: "https://a" }, undefined)).toBe("https://a");
    expect(
      toolActionResource({ kind: "mcp.call", callId: "c", toolName: "t", mcpServerId: "s", mcpToolName: "m" }, undefined),
    ).toBe("mcp://s/m");
  });
});
