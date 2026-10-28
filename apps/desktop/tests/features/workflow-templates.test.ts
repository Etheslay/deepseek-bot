// @vitest-environment jsdom
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WORKFLOW_SCHEMA_VERSION, type WorkflowDraft } from "@deepseek-bot/contracts";
import {
  deleteWorkflowTemplate,
  listWorkflowTemplates,
  MAX_WORKFLOW_TEMPLATES,
  saveWorkflowTemplate,
  type WorkflowTemplate,
} from "../../src/renderer/src/features/workflow-editor/template/workflow-templates.js";

function draft(name = "日报工作流"): WorkflowDraft {
  return {
    name,
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    nodes: [
      {
        id: "n1",
        type: "bot",
        botId: randomUUID(),
        instructionTemplate: "总结输入并输出要点。",
        inputBindings: [],
        retryPolicy: { maxRetries: 0 },
      },
    ],
    edges: [],
    limits: { maxConcurrentNodes: 1 },
  };
}

describe("workflow templates store", () => {
  it("saves and lists contract-valid drafts", () => {
    const storage = window.localStorage;
    storage.clear();
    const result = saveWorkflowTemplate(storage, { name: "日报工作流", workflow: draft() });
    expect(result.ok).toBe(true);
    const list = listWorkflowTemplates(storage);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("日报工作流");
    expect(list[0]?.id).toMatch(/^wtpl-/);
    expect(list[0]?.workflow.nodes).toHaveLength(1);
  });

  it("rejects drafts that fail the frozen contract schema", () => {
    const storage = window.localStorage;
    storage.clear();
    const broken = draft() as unknown as Record<string, unknown>;
    delete broken.schemaVersion;
    const result = saveWorkflowTemplate(storage, {
      name: "坏模板",
      workflow: broken as unknown as WorkflowDraft,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
    }
    expect(listWorkflowTemplates(storage)).toEqual([]);
  });

  it("strips policy fields smuggled into node objects (G11' tamper case)", () => {
    const storage = window.localStorage;
    storage.clear();
    const tampered = draft("越权工作流");
    tampered.nodes.push({
      id: "n2",
      type: "bot",
      botId: randomUUID(),
      instructionTemplate: "x",
      inputBindings: [],
      retryPolicy: { maxRetries: 0 },
      // Fields a tampered template hopes to smuggle past the shelf.
      toolPolicyId: randomUUID(),
      permissions: { shell: "allow" },
      allowedTools: ["exec.shell"],
    } as unknown as WorkflowDraft["nodes"][number]);
    const result = saveWorkflowTemplate(storage, { name: "越权工作流", workflow: tampered });
    expect(result.ok).toBe(true);
    const stored = listWorkflowTemplates(storage)[0];
    expect(stored).toBeDefined();
    const node = stored?.workflow.nodes.find((entry) => entry.id === "n2") as Record<string, unknown>;
    expect(node).not.toHaveProperty("toolPolicyId");
    expect(node).not.toHaveProperty("permissions");
    expect(node).not.toHaveProperty("allowedTools");
  });

  it("rejects duplicate template names", () => {
    const storage = window.localStorage;
    storage.clear();
    expect(saveWorkflowTemplate(storage, { name: "同名", workflow: draft("甲") }).ok).toBe(true);
    const second = saveWorkflowTemplate(storage, { name: "同名", workflow: draft("乙") });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("duplicate");
    }
  });

  it("enforces the cap", () => {
    const storage = window.localStorage;
    storage.clear();
    for (let i = 0; i < MAX_WORKFLOW_TEMPLATES; i += 1) {
      expect(saveWorkflowTemplate(storage, { name: `模板-${i}`, workflow: draft(`流程-${i}`) }).ok).toBe(true);
    }
    const overflow = saveWorkflowTemplate(storage, { name: "超出", workflow: draft("超出") });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.reason).toBe("limit");
    }
  });

  it("deletes by id and survives corrupt payloads", () => {
    const storage = window.localStorage;
    storage.clear();
    const saved = saveWorkflowTemplate(storage, { name: "待删", workflow: draft() });
    expect(saved.ok).toBe(true);
    const id = (saved as { template: WorkflowTemplate }).template.id;
    expect(deleteWorkflowTemplate(storage, id)).toHaveLength(0);

    storage.setItem("deepseek-bot.workflow-templates.v1", "not-json");
    expect(listWorkflowTemplates(storage)).toEqual([]);
  });

  it("drops shelf entries the current schema version rejects", () => {
    const storage = window.localStorage;
    storage.clear();
    expect(saveWorkflowTemplate(storage, { name: "现行", workflow: draft() }).ok).toBe(true);
    const raw = JSON.parse(storage.getItem("deepseek-bot.workflow-templates.v1") ?? "[]") as unknown[];
    raw.push({
      id: "wtpl-future",
      name: "未来版本",
      createdAt: new Date().toISOString(),
      workflow: { ...draft("未来版本"), schemaVersion: "9.9" },
    });
    storage.setItem("deepseek-bot.workflow-templates.v1", JSON.stringify(raw));
    const list = listWorkflowTemplates(storage);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("现行");
  });
});
