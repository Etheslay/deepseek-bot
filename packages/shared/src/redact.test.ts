import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("masks sk- style API keys", () => {
    const input = "token=sk-abc123XYZ_demo-key";
    const result = redactSecrets(input);
    expect(result).toBe("token=[REDACTED]");
    expect(result).not.toContain("sk-");
  });

  it("masks Bearer authorization values", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig";
    const result = redactSecrets(input);
    expect(result).toBe("Authorization: Bearer [REDACTED]");
    expect(result).not.toContain("eyJ");
  });

  it("masks DEEPSEEK_API_KEY environment assignments", () => {
    const input = "export DEEPSEEK_API_KEY=plain-deepseek-secret";
    const result = redactSecrets(input);
    expect(result).toBe("export DEEPSEEK_API_KEY=[REDACTED]");
    expect(result).not.toContain("plain-deepseek-secret");
  });

  it("masks api_key assignments", () => {
    const input = "config api_key=plain-secret-value";
    const result = redactSecrets(input);
    expect(result).toBe("config api_key=[REDACTED]");
    expect(result).not.toContain("plain-secret");
  });

  it("returns plain text unchanged", () => {
    const input = "hello world — no secrets here";
    expect(redactSecrets(input)).toBe(input);
  });

  it("returns empty string for empty input", () => {
    expect(redactSecrets("")).toBe("");
  });
});
