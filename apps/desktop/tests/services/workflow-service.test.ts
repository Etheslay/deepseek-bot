import { describe, expect, it } from "vitest";
import type { Workflow, WorkflowDraft } from "@deepseek-bot/contracts";
import { WorkflowSchema } from "@deepseek-bot/contracts";
import cycleFixture from "@deepseek-bot/contracts/fixtures/workflow-cycle.json";
import missingBindingFixture from "@deepseek-bot/contracts/fixtures/workflow-missing-binding.json";
import { ServiceError } from "../../src/renderer/src/services/desktop-service.js";
import {
  createFixtureWorkflowService,
} from "../../src/renderer/src/features/workflow-editor/workflow-service.js";

const BOT_A = "11111111-1111-4111-8111-111111111111";
const BOT_B = "12121212-1212-4121-8121-121212121212";
const SEED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SEED_REVISION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const cycleDraft = cycleFixture.interactions[0]!.envelope.payload
  .workflow as unknown as WorkflowDraft;
const missingBindingDraft = missingBindingFixture.interactions[0]!.envelope.payload
  .workflow as unknown as WorkflowDraft;

function validDraft(): WorkflowDraft {
  return {
    name: "new-flow",
    schemaVersion: "0.1",
    nodes: [
      {
        id: "a",
        type: "bot",
        botId: BOT_A,
        instructionTemplate: "step",
        inputBindings: [],
        retryPolicy: { maxRetries: 0 },
      },
    ],
    edges: [],
    limits: { maxConcurrentNodes: 2 },
  };
}

async function saveAndGet(service: ReturnType<typeof createFixtureWorkflowService>): Promise<Workflow> {
  return service.save(validDraft());
}

describe("FixtureWorkflowService.save", () => {
  it("seeds one valid workflow in the catalog", async () => {
    const service = createFixtureWorkflowService();
    const list = await service.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: SEED_ID, name: "sample-review-flow" });
  });

  it("creates a workflow with fresh id/revision, schema-validated", async () => {
    const service = createFixtureWorkflowService();
    const saved = await saveAndGet(service);
    expect(saved.id).not.toBe(SEED_ID);
    expect(saved.revision).toMatch(/^[0-9a-f-]{36}$/);
    expect(WorkflowSchema.safeParse(saved).success).toBe(true);
    expect((await service.list())).toHaveLength(2);
  });

  it("updates with the matching expectedRevision and rotates the revision", async () => {
    const service = createFixtureWorkflowService();
    const saved = await saveAndGet(service);
    const updated = await service.save(
      { ...saved, name: "renamed" },
      saved.revision,
    );
    expect(updated.id).toBe(saved.id);
    expect(updated.revision).not.toBe(saved.revision);
    expect(updated.name).toBe("renamed");
    expect((await service.list())).toHaveLength(2);
  });

  it("rejects a save with a stale revision (REVISION_CONFLICT, no overwrite)", async () => {
    const service = createFixtureWorkflowService();
    const saved = await saveAndGet(service);
    const first = await service.save({ ...saved, name: "first" }, saved.revision);
    await expect(service.save({ ...first, name: "second" }, saved.revision)).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
    const current = await service.get(first.id);
    expect(current.name).toBe("first");
  });

  it("rejects an update without expectedRevision", async () => {
    const service = createFixtureWorkflowService();
    const saved = await saveAndGet(service);
    await expect(service.save({ ...saved, name: "x" })).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
  });

  it("refuses to save a cyclic draft (带病保存) and locates the cycle", async () => {
    const service = createFixtureWorkflowService();
    await expect(service.save(cycleDraft)).rejects.toSatisfy((error: unknown) => {
      const issue = error as ServiceError;
      return issue.code === "WORKFLOW_CYCLE" && issue.message.includes("cycle");
    });
    expect((await service.list())).toHaveLength(1);
  });

  it("rejects an unknown workflow id on update", async () => {
    const service = createFixtureWorkflowService();
    await expect(
      service.save({ ...validDraft(), id: BOT_A, revision: SEED_REVISION }, SEED_REVISION),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("FixtureWorkflowService.validate (contract fixtures)", () => {
  it("locates WORKFLOW_CYCLE on a cycle node with field=edges", async () => {
    const service = createFixtureWorkflowService();
    const result = await service.validate(cycleDraft);
    expect(result.valid).toBe(false);
    const cycle = result.errors.find((issue) => issue.code === "WORKFLOW_CYCLE");
    expect(cycle).toBeDefined();
    expect(cycle!.nodeId).toBeOneOf(["n1", "n2"]);
    expect(cycle!.field).toBe("edges");
  });

  it("locates MISSING_BINDING on the node and inputBindings.<key> field", async () => {
    const service = createFixtureWorkflowService();
    const result = await service.validate(missingBindingDraft);
    expect(result.valid).toBe(false);
    const binding = result.errors.find((issue) => issue.code === "MISSING_BINDING");
    expect(binding).toMatchObject({ nodeId: "n2", field: "inputBindings.topic" });
    expect(binding!.message).toContain("topic");
  });

  it("reports duplicate node ids as INVALID_INPUT with field=id", async () => {
    const service = createFixtureWorkflowService();
    const draft = validDraft();
    draft.nodes.push({ ...draft.nodes[0]! });
    const result = await service.validate(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === "INVALID_INPUT" && issue.field === "id")).toBe(true);
  });

  it("rejects an approval node carrying botId, located at the node", async () => {
    const service = createFixtureWorkflowService();
    const draft = validDraft();
    draft.nodes.push({
      id: "ap",
      type: "approval",
      botId: BOT_B,
      instructionTemplate: "",
      inputBindings: [],
      retryPolicy: { maxRetries: 0 },
    });
    const result = await service.validate(draft);
    expect(result.valid).toBe(false);
    const issue = result.errors.find((entry) => entry.nodeId === "ap");
    expect(issue?.code).toBe("INVALID_INPUT");
    expect(issue?.field).toBe("botId");
  });

  it("accepts the seed workflow as valid", async () => {
    const service = createFixtureWorkflowService();
    const seed = await service.get(SEED_ID);
    const draft: WorkflowDraft = {
      name: seed.name,
      schemaVersion: seed.schemaVersion,
      nodes: seed.nodes,
      edges: seed.edges,
      limits: seed.limits,
    };
    expect((await service.validate(draft)).valid).toBe(true);
  });
});

describe("FixtureWorkflowService.export / copy", () => {
  it("exports with exportedAt and rejects a stale revision", async () => {
    const service = createFixtureWorkflowService();
    const result = await service.exportTemplate(SEED_ID, SEED_REVISION);
    expect(result.workflow.id).toBe(SEED_ID);
    expect(Number.isNaN(Date.parse(result.exportedAt))).toBe(false);
    await expect(service.exportTemplate(SEED_ID, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject(
      { code: "REVISION_CONFLICT" },
    );
  });

  it("copies with new ids, 副本 name and remapped node ids", async () => {
    const service = createFixtureWorkflowService();
    const copy = await service.copy(SEED_ID);
    expect(copy.id).not.toBe(SEED_ID);
    expect(copy.name).toBe("sample-review-flow 副本");
    expect(copy.nodes.map((node) => node.id).sort()).toEqual(["draft-bot-copy", "human-approve-copy"]);
    expect(copy.edges[0]).toMatchObject({
      fromNodeId: "draft-bot-copy",
      toNodeId: "human-approve-copy",
    });
    expect(WorkflowSchema.safeParse(copy).success).toBe(true);
  });
});

describe("FixtureWorkflowService.importTemplate", () => {
  it("accepts a template exported from the fixture and round-trips the graph", async () => {
    const service = createFixtureWorkflowService();
    const { workflow } = await service.exportTemplate(SEED_ID, SEED_REVISION);
    const template = { schemaVersion: workflow.schemaVersion, workflow };
    const result = await service.importTemplate(template);

    expect(result.accepted).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.draft).toMatchObject({
      name: workflow.name,
      limits: workflow.limits,
    });
    expect(result.draft!.nodes).toEqual(workflow.nodes);
    expect(result.draft!.edges).toEqual(workflow.edges);
  });

  it("rejects a higher template schemaVersion with DATA_VERSION_UNSUPPORTED before graph checks", async () => {
    const service = createFixtureWorkflowService();
    const template = {
      schemaVersion: "9.9",
      workflow: { ...validDraft(), schemaVersion: "9.9" },
    };
    const result = await service.importTemplate(template);
    expect(result).toMatchObject({ accepted: false, errorCode: "DATA_VERSION_UNSUPPORTED" });
    expect(result.errors).toEqual([]);
  });

  it("checks workflow.schemaVersion after template.schemaVersion", async () => {
    const service = createFixtureWorkflowService();
    const result = await service.importTemplate({
      schemaVersion: "0.1",
      workflow: { ...validDraft(), schemaVersion: "9.9" },
    });
    expect(result).toMatchObject({ accepted: false, errorCode: "DATA_VERSION_UNSUPPORTED" });
  });

  it("rejects a non-object template and a missing schemaVersion with INVALID_INPUT", async () => {
    const service = createFixtureWorkflowService();
    expect(await service.importTemplate("nope")).toMatchObject({ accepted: false, errorCode: "INVALID_INPUT" });
    expect(await service.importTemplate({ workflow: validDraft() })).toMatchObject({
      accepted: false,
      errorCode: "INVALID_INPUT",
    });
  });

  it("rejects templates over the 1 MiB message cap", async () => {
    const service = createFixtureWorkflowService();
    const big = {
      schemaVersion: "0.1",
      workflow: { ...validDraft(), name: "x".repeat(1_100_000) },
    };
    const result = await service.importTemplate(big);
    expect(result).toMatchObject({ accepted: false, errorCode: "INVALID_INPUT" });
    expect(result.errors[0]!.message).toContain("1 MiB");
  });

  it("rejects an invalid graph with located issues, without accepting", async () => {
    const service = createFixtureWorkflowService();
    const result = await service.importTemplate({
      schemaVersion: "0.1",
      workflow: missingBindingDraft,
    });
    expect(result.accepted).toBe(false);
    expect(result.errors.some((issue) => issue.code === "MISSING_BINDING")).toBe(true);
  });

  it("rejects an approval node with botId, locating nodeId + field", async () => {
    const service = createFixtureWorkflowService();
    const workflow = { ...validDraft() };
    workflow.nodes.push({
      id: "ap",
      type: "approval",
      botId: BOT_B,
      instructionTemplate: "",
      inputBindings: [],
      retryPolicy: { maxRetries: 0 },
    });
    const result = await service.importTemplate({ schemaVersion: "0.1", workflow });
    expect(result.accepted).toBe(false);
    expect(result.errors.some((issue) => issue.nodeId === "ap" && issue.field === "botId")).toBe(true);
  });
});
