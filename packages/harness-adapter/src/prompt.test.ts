import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NodeExecutionError } from "@deepseek-bot/runtime";
import type { Bot, WorkflowNode } from "@deepseek-bot/contracts";
import { composeNodePrompt, renderInstructionTemplate } from "./prompt.js";

function bot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: randomUUID(),
    revision: randomUUID(),
    name: "报告机器人",
    instructions: "始终使用简洁中文回复。",
    modelProfileId: randomUUID(),
    workspaceId: randomUUID(),
    toolPolicyId: randomUUID(),
    role: "standard",
    archivedAt: null,
    ...overrides,
  };
}

function node(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: "node-1",
    type: "bot",
    instructionTemplate: "把 {{input.topic}} 写成一段话。",
    inputBindings: [],
    retryPolicy: { maxRetries: 0 },
    ...overrides,
  };
}

describe("renderInstructionTemplate", () => {
  it("inserts string inputs verbatim", () => {
    expect(renderInstructionTemplate("主题：{{input.topic}}", { topic: "本地调度" })).toBe(
      "主题：本地调度",
    );
  });

  it("serializes non-string inputs as JSON", () => {
    expect(renderInstructionTemplate("数据：{{input.payload}}", { payload: { a: 1 } })).toBe(
      '数据：{"a":1}',
    );
    expect(renderInstructionTemplate("计数：{{input.count}}", { count: 3 })).toBe("计数：3");
    expect(renderInstructionTemplate("空值：{{input.void}}", { void: undefined })).toBe("空值：null");
  });

  it("tolerates whitespace inside the placeholder", () => {
    expect(renderInstructionTemplate("{{ input.topic }}", { topic: "x" })).toBe("x");
  });

  it("rejects placeholders without a matching input", () => {
    const error = (() => {
      try {
        renderInstructionTemplate("{{input.missing}}", { topic: "x" });
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(NodeExecutionError);
    expect((error as NodeExecutionError).code).toBe("INVALID_INPUT");
    expect((error as NodeExecutionError).retryable).toBe(false);
  });

  it("leaves text without placeholders untouched", () => {
    expect(renderInstructionTemplate("no placeholders here", {})).toBe("no placeholders here");
  });
});

describe("composeNodePrompt", () => {
  it("composes standing instructions, task and inputs sections", () => {
    const prompt = composeNodePrompt(bot(), node(), { topic: "调度器" });
    expect(prompt).toContain("## Standing instructions\n始终使用简洁中文回复。");
    expect(prompt).toContain("## Task\n把 调度器 写成一段话。");
    expect(prompt).toContain("## Inputs\n- topic: 调度器");
  });

  it("omits the inputs section when there are no inputs", () => {
    const plainNode = node({ instructionTemplate: "写一段话。" });
    const prompt = composeNodePrompt(bot(), plainNode, {});
    expect(prompt).not.toContain("## Inputs");
  });

  it("serializes structured inputs in the inputs section", () => {
    const plainNode = node({ instructionTemplate: "处理数据。" });
    const prompt = composeNodePrompt(bot(), plainNode, { rows: [1, 2] });
    expect(prompt).toContain("- rows: [1,2]");
  });
});
