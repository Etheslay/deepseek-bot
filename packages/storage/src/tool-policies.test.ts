/**
 * Tool policy repository tests (D08): create-or-return, JSON column
 * validation, update with revision guard, boot generation helpers.
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { ToolPolicy } from "@deepseek-bot/contracts";
import {
  createToolPolicy,
  getBootGeneration,
  getToolPolicy,
  incrementBootGeneration,
  listToolPolicies,
  updateToolPolicy,
} from "./index.js";
import { makeLayout, makeTempRoot, openTestDatabase } from "./test-support.js";

function makePolicy(overrides: Partial<ToolPolicy> = {}): ToolPolicy {
  return {
    id: randomUUID(),
    revision: randomUUID(),
    name: "默认策略",
    filesystem: { enabled: true, operations: ["read", "write"] },
    shell: { mode: "approval-required" },
    network: { mode: "disabled" },
    mcp: {
      enabled: true,
      requireApproval: false,
      servers: [{ serverId: "fs-mcp", allowedTools: ["list_files"] }],
    },
    ...overrides,
  };
}

describe("tool policy repository", () => {
  it("creates, returns existing on duplicate id and reads back", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const policy = makePolicy();
    const first = createToolPolicy(db, policy);
    expect(first.created).toBe(true);
    expect(first.policy.filesystem).toEqual({ enabled: true, operations: ["read", "write"] });
    const duplicate = createToolPolicy(db, policy);
    expect(duplicate.created).toBe(false);
    expect(getToolPolicy(db, policy.id)).toEqual(policy);
    expect(getToolPolicy(db, randomUUID())).toBeUndefined();
    expect(listToolPolicies(db).map((row) => row.id)).toEqual([policy.id]);
    db.close();
  });

  it("rejects policies that violate the contract schema", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    expect(() =>
      createToolPolicy(db, makePolicy({ shell: { mode: "allowed" as never } })),
    ).toThrowError(/approval-required/);
    db.close();
  });

  it("updates fields and guards revisions", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const policy = makePolicy();
    createToolPolicy(db, policy);
    const updated = updateToolPolicy(db, {
      id: policy.id,
      expectedRevision: policy.revision,
      patch: {
        revision: randomUUID(),
        network: { mode: "approval-required" },
      },
    });
    expect(updated.network).toEqual({ mode: "approval-required" });
    expect(updated.filesystem.enabled).toBe(true);
    expect(getToolPolicy(db, policy.id)?.network.mode).toBe("approval-required");

    expect(() =>
      updateToolPolicy(db, {
        id: policy.id,
        expectedRevision: policy.revision,
        patch: { name: "冲突更新" },
      }),
    ).toThrowError(/revision conflict/);
    expect(() =>
      updateToolPolicy(db, { id: randomUUID(), patch: { name: "缺失" } }),
    ).toThrowError(/not found/);
    db.close();
  });
});

describe("host boot generation", () => {
  it("starts at 0 and increments persistently", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    expect(getBootGeneration(db)).toBe(0);
    expect(incrementBootGeneration(db)).toBe(1);
    expect(incrementBootGeneration(db)).toBe(2);
    expect(getBootGeneration(db)).toBe(2);
    db.close();
  });
});
