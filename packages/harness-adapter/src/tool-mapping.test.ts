import { describe, expect, it } from "vitest";
import { mapHarnessToolCall, parseToolArguments } from "./tool-mapping.js";

describe("parseToolArguments", () => {
  it("decodes JSON-string arguments (verified D01 wire shape)", () => {
    expect(parseToolArguments('{"file_path":"a.txt","content":"hi"}')).toEqual({
      file_path: "a.txt",
      content: "hi",
    });
  });

  it("passes objects through and degrades everything else to empty", () => {
    expect(parseToolArguments({ path: "x" })).toEqual({ path: "x" });
    expect(parseToolArguments("not json")).toEqual({});
    expect(parseToolArguments("[1,2]")).toEqual({});
    expect(parseToolArguments(undefined)).toEqual({});
  });
});

describe("mapHarnessToolCall", () => {
  it("maps the verified write tool with its file_path argument", () => {
    const action = mapHarnessToolCall({
      toolName: "write",
      callId: "call_1",
      arguments: '{"file_path":"D:\\\\ws\\\\hello.txt","content":"hi"}',
    });
    expect(action).toMatchObject({
      kind: "file.write",
      callId: "call_1",
      toolName: "write",
      path: "D:\\ws\\hello.txt",
    });
  });

  it("maps read, shell, network and delete tools to their kinds", () => {
    expect(
      mapHarnessToolCall({ toolName: "read", callId: "c2", arguments: '{"file_path":"a.txt"}' }),
    ).toMatchObject({ kind: "file.read", path: "a.txt" });
    expect(
      mapHarnessToolCall({ toolName: "bash", callId: "c3", arguments: '{"command":"dir"}' }),
    ).toMatchObject({ kind: "shell.exec", command: "dir" });
    expect(
      mapHarnessToolCall({ toolName: "web_fetch", callId: "c4", arguments: '{"url":"https://x"}' }),
    ).toMatchObject({ kind: "network.request", url: "https://x" });
    expect(
      mapHarnessToolCall({ toolName: "rm", callId: "c5", arguments: '{"file_path":"a.txt"}' }),
    ).toMatchObject({ kind: "file.delete", path: "a.txt" });
    expect(
      mapHarnessToolCall({ toolName: "glob", callId: "c6", arguments: '{"path":"."}' }),
    ).toMatchObject({ kind: "file.list", path: "." });
  });

  it("splits MCP tool names into server and tool identities", () => {
    expect(
      mapHarnessToolCall({ toolName: "mcp__docs__search", callId: "c7", arguments: "{}" }),
    ).toMatchObject({ kind: "mcp.call", mcpServerId: "docs", mcpToolName: "search" });
    expect(
      mapHarnessToolCall({ toolName: "mcp__team_server__run", callId: "c8", arguments: "{}" }),
    ).toMatchObject({ kind: "mcp.call", mcpServerId: "team_server", mcpToolName: "run" });
  });

  it("keeps the full parsed arguments for the action digest", () => {
    const action = mapHarnessToolCall({
      toolName: "write",
      callId: "c9",
      arguments: '{"file_path":"a.txt","content":"hi"}',
    });
    expect(action?.arguments).toEqual({ file_path: "a.txt", content: "hi" });
  });

  it("returns undefined for unmapped tools (fail closed)", () => {
    expect(mapHarnessToolCall({ toolName: "totally_new_tool", callId: "c10", arguments: "{}" })).toBeUndefined();
  });
});
