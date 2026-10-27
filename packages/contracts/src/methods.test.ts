import { describe, expect, it } from "vitest";
import {
  MAX_ARTIFACT_CONTENT_BYTES,
  MAX_MESSAGE_BYTES,
  METHODS,
  METHOD_CONTRACTS,
  RequestEnvelopeSchema,
  isProtocolVersionSupported,
  isWithinMessageSizeLimit,
  messageSizeBytes,
  parseRequest,
  type Method,
} from "./index.js";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";

function envelope(method: Method, payload: unknown): unknown {
  return {
    protocolVersion: "0.1",
    requestId: REQUEST_ID,
    method,
    payload,
  };
}

describe("method whitelist", () => {
  it("defines a contract for every whitelisted method and nothing else", () => {
    const contractMethods = Object.keys(METHOD_CONTRACTS).sort();
    expect(contractMethods).toEqual([...METHODS].sort());
    expect(METHODS).toHaveLength(91);
  });

  it("covers every method group from CONTRACTS §3", () => {
    const groups = new Set(METHODS.map((method) => method.split(".")[0]));
    expect([...groups].sort()).toEqual([
      "approval",
      "artifacts",
      "bot",
      "chat",
      "connector",
      "creation",
      "data",
      "events",
      "grant",
      "group",
      "knowledge",
      "memory",
      "permission",
      "policy",
      "question",
      "run",
      "schedule",
      "screen",
      "search",
      "settings",
      "task",
      "tool",
      "trigger",
      "workflow",
    ]);
  });
});

describe("protocol version", () => {
  it("accepts v0.7 and previous v0.1–v0.6 senders", () => {
    expect(isProtocolVersionSupported("0.2")).toBe(true);
    expect(isProtocolVersionSupported("0.1")).toBe(true);
    expect(isProtocolVersionSupported("0.3")).toBe(true);
    expect(isProtocolVersionSupported("0.4")).toBe(true);
    expect(isProtocolVersionSupported("0.5")).toBe(true);
    expect(isProtocolVersionSupported("0.6")).toBe(true);
    expect(isProtocolVersionSupported("0.7")).toBe(true);
    expect(isProtocolVersionSupported("1.0")).toBe(false);
  });

  it("rejects unknown or higher protocol versions outright", () => {
    const result = RequestEnvelopeSchema.safeParse({
    protocolVersion: "0.8",
      requestId: REQUEST_ID,
      method: "bot.list",
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects methods outside the whitelist", () => {
    const result = RequestEnvelopeSchema.safeParse({
      protocolVersion: "0.1",
      requestId: REQUEST_ID,
      method: "bot.delete",
      payload: {},
    });
    expect(result.success).toBe(false);
  });
});

describe("message size limit", () => {
  it("measures utf-8 payload size", () => {
    expect(messageSizeBytes({ hello: "world" })).toBeGreaterThan(0);
  });

  it("rejects payloads above 1 MiB before payload parsing", () => {
    const big = { blob: "x".repeat(MAX_MESSAGE_BYTES) };
    expect(isWithinMessageSizeLimit(big)).toBe(false);
    const result = parseRequest(envelope("bot.list", big), "bot.list");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]?.path).toEqual(["payload"]);
    }
  });
});

describe("parseRequest", () => {
  it("accepts a valid bot.list request", () => {
    const result = parseRequest(envelope("bot.list", {}), "bot.list");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.requestId).toBe(REQUEST_ID);
      expect(result.method).toBe("bot.list");
      expect(result.payload).toEqual({});
    }
  });

  it("rejects a mismatched method", () => {
    const result = parseRequest(envelope("bot.list", {}), "run.get");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]?.path).toEqual(["method"]);
    }
  });

  it("rejects malformed payloads with locatable issues", () => {
    const result = parseRequest(
      envelope("run.get", { wrong: "shape" }),
      "run.get",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((issue) => issue.path.includes("runId"))).toBe(
        true,
      );
    }
  });

  it("validates approval.decide payload shape", () => {
    const valid = parseRequest(
      envelope("approval.decide", {
        approvalId: "12341234-1234-4123-8123-123412341234",
        decision: "approved",
        expectedActionDigest:
          "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      }),
      "approval.decide",
    );
    expect(valid.success).toBe(true);

    const invalid = parseRequest(
      envelope("approval.decide", {
        approvalId: "12341234-1234-4123-8123-123412341234",
        decision: "maybe",
        expectedActionDigest: "nope",
      }),
      "approval.decide",
    );
    expect(invalid.success).toBe(false);
  });

  it("applies run.list defaults", () => {
    const result = parseRequest(envelope("run.list", {}), "run.list");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.limit).toBe(50);
    }
  });

  it("rejects bot.update patches without any changed field", () => {
    const result = parseRequest(
      envelope("bot.update", {
        id: "11111111-1111-4111-8111-111111111111",
        expectedRevision: "22222222-2222-4222-8222-222222222222",
        patch: {},
      }),
      "bot.update",
    );
    expect(result.success).toBe(false);
  });

  it("validates bot.batchCreate payloads", () => {
    const profileId = "44444444-4444-4444-8444-444444444444";
    const workspaceId = "55555555-5555-4555-8555-555555555555";
    const groupId = "77777777-7777-4777-8777-777777777777";
    const batchId = "88888888-8888-4888-8888-888888888888";

    const valid = parseRequest(
      envelope("bot.batchCreate", {
        newGroup: { name: "research-squad" },
        defaults: {
          modelProfileId: profileId,
          workspaceId,
          toolPolicyId: "66666666-6666-4666-8666-666666666666",
        },
        bots: [{ name: "scout", instructions: "Look things up." }],
      }),
      "bot.batchCreate",
    );
    expect(valid.success).toBe(true);

    const withGroup = parseRequest(
      envelope("bot.batchCreate", {
        groupId,
        bots: [
          {
            name: "scout",
            instructions: "Look things up.",
            avatar: { shape: "egg", color: "#f0b429" },
          },
        ],
        idempotencyKey: batchId,
      }),
      "bot.batchCreate",
    );
    expect(withGroup.success).toBe(true);

    expect(
      parseRequest(
        envelope("bot.batchCreate", {
          groupId,
          newGroup: { name: "duplicate" },
          bots: [{ name: "scout", instructions: "Look things up." }],
        }),
        "bot.batchCreate",
      ).success,
    ).toBe(false);
    expect(
      parseRequest(
        envelope("bot.batchCreate", { bots: [] }),
        "bot.batchCreate",
      ).success,
    ).toBe(false);
    expect(
      parseRequest(
        envelope("bot.batchCreate", {
          bots: [
            {
              name: "scout",
              instructions: "Look things up.",
              avatar: { shape: "egg", color: "#ff00ff" },
            },
          ],
        }),
        "bot.batchCreate",
      ).success,
    ).toBe(false);
  });

  it("validates group.create, group.list and creation.revoke payloads", () => {
    expect(
      parseRequest(envelope("group.create", { name: "ops" }), "group.create")
        .success,
    ).toBe(true);
    expect(
      parseRequest(envelope("group.create", { name: "" }), "group.create")
        .success,
    ).toBe(false);
    expect(parseRequest(envelope("group.list", {}), "group.list").success).toBe(
      true,
    );
    expect(
      parseRequest(
        envelope("creation.revoke", {
          batchId: "88888888-8888-4888-8888-888888888888",
        }),
        "creation.revoke",
      ).success,
    ).toBe(true);
    expect(
      parseRequest(envelope("creation.revoke", { batchId: "nope" }), "creation.revoke")
        .success,
    ).toBe(false);
  });

  it("validates artifacts.save payloads and rejects traversal paths (D28)", () => {
    const botId = "11111111-1111-4111-8111-111111111111";
    expect(
      parseRequest(
        envelope("artifacts.save", {
          botId,
          path: "notes/todo.md",
          content: "# hello",
        }),
        "artifacts.save",
      ).success,
    ).toBe(true);
    expect(
      parseRequest(
        envelope("artifacts.save", {
          botId,
          path: "notes/todo.md",
          content: "# hello",
          expectedChecksum: "a".repeat(64),
        }),
        "artifacts.save",
      ).success,
    ).toBe(true);
    for (const traversal of ["../escape.md", "a/../../b.md", "C:\\abs.md", "/abs.md", "a//b.md"]) {
      expect(
        parseRequest(
          envelope("artifacts.read", { botId, path: traversal }),
          "artifacts.read",
        ).success,
        `expected traversal rejection for ${traversal}`,
      ).toBe(false);
    }
  });

  it("rejects artifact content above the co-edit budget (D28)", () => {
    expect(MAX_ARTIFACT_CONTENT_BYTES).toBeLessThan(MAX_MESSAGE_BYTES);
    const result = parseRequest(
      envelope("artifacts.save", {
        botId: "11111111-1111-4111-8111-111111111111",
        path: "notes/todo.md",
        content: "x".repeat(MAX_ARTIFACT_CONTENT_BYTES + 1),
      }),
      "artifacts.save",
    );
    expect(result.success).toBe(false);
  });

  it("validates knowledge payloads (D18 independent knowledge table)", () => {
    const botId = "77777777-7777-4777-8777-777777777777";
    const docId = "99999999-9999-4999-8999-999999999999";
    expect(
      parseRequest(envelope("knowledge.list", { botId }), "knowledge.list")
        .success,
    ).toBe(true);
    expect(
      parseRequest(
        envelope("knowledge.write", {
          botId,
          title: "产品手册",
          text: "很长的正文……",
        }),
        "knowledge.write",
      ).success,
    ).toBe(true);
    expect(
      parseRequest(
        envelope("knowledge.write", { botId, title: "t", text: "  " }),
        "knowledge.write",
      ).success,
    ).toBe(false);
    expect(
      parseRequest(
        envelope("knowledge.delete", { botId, docId }),
        "knowledge.delete",
      ).success,
    ).toBe(true);
    const search = parseRequest(
      envelope("knowledge.search", { botId, query: "部署流程" }),
      "knowledge.search",
    );
    expect(search.success).toBe(true);
    if (search.success) {
      expect(search.payload.limit).toBe(5);
    }
    expect(
      parseRequest(
        envelope("knowledge.search", { botId, query: "" }),
        "knowledge.search",
      ).success,
    ).toBe(false);
  });

  it("validates the retention policy payloads (D18 保留策略)", () => {
    expect(
      parseRequest(envelope("memory.retention.get", {}), "memory.retention.get")
        .success,
    ).toBe(true);
    const policy = { retentionDays: 30, memoryMaxPerBot: 500, knowledgeMaxPerBot: 100 };
    expect(
      parseRequest(
        envelope("memory.retention.set", { policy }),
        "memory.retention.set",
      ).success,
    ).toBe(true);
    expect(
      parseRequest(
        envelope("memory.retention.set", {
          policy: { retentionDays: -1, memoryMaxPerBot: 0, knowledgeMaxPerBot: 0 },
        }),
        "memory.retention.set",
      ).success,
    ).toBe(false);
    expect(
      parseRequest(
        envelope("memory.retention.set", {
          policy: { retentionDays: 0, memoryMaxPerBot: 0, knowledgeMaxPerBot: 0 },
        }),
        "memory.retention.set",
      ).success,
    ).toBe(true);
  });
});


