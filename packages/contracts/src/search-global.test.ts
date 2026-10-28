import { describe, expect, it } from "vitest";
import { METHOD_CONTRACTS, METHODS } from "./index.js";

const HIT = {
  kind: "message",
  id: "10000000-0000-4000-8000-000000000001",
  botId: "20000000-0000-4000-8000-000000000002",
  title: "alpha",
  snippet: "请总结季度报告",
  at: "2026-10-28T00:00:00.000Z",
};

describe("D25 search.global contract", () => {
  it("registers on the whitelist with a contract entry", () => {
    expect(METHODS).toContain("search.global");
    expect(METHOD_CONTRACTS["search.global"]).toBeDefined();
  });

  it("bounds the query and defaults the limit", () => {
    const contract = METHOD_CONTRACTS["search.global"];
    expect(contract.request.safeParse({ query: "季度" }).success).toBe(true);
    expect(contract.request.safeParse({ query: "季度", limit: 5 }).success).toBe(true);
    expect(contract.request.safeParse({ query: "" }).success).toBe(false);
    expect(contract.request.safeParse({ query: "x".repeat(201) }).success).toBe(false);
    expect(contract.request.safeParse({ query: "季度", limit: 0 }).success).toBe(false);
    expect(contract.request.safeParse({ query: "季度", limit: 51 }).success).toBe(false);
    expect(contract.request.safeParse({ query: "季度", extra: true }).success).toBe(false);
  });

  it("accepts strict hits and rejects loose ones", () => {
    const contract = METHOD_CONTRACTS["search.global"];
    expect(contract.response.safeParse({ results: [HIT] }).success).toBe(true);
    expect(contract.response.safeParse({ results: [] }).success).toBe(true);
    for (const broken of [
      { ...HIT, kind: "file" },
      { ...HIT, id: "not-a-uuid" },
      { ...HIT, botId: "not-a-uuid" },
      { ...HIT, title: "" },
      { ...HIT, snippet: "x".repeat(401) },
      { ...HIT, at: "not-a-date" },
      { ...HIT, path: "C:\\secret" },
    ]) {
      expect(contract.response.safeParse({ results: [broken] }).success).toBe(false);
    }
    expect(
      contract.response.safeParse({ results: [{ ...HIT, botId: null, at: null, snippet: null }] })
        .success,
    ).toBe(true);
  });
});
