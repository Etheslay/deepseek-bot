import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  getModelProfile,
  listModelProfiles,
  updateModelProfile,
  getSchedule,
  listSchedules,
  createBot,
  archiveBot,
  getBot,
  listBots,
  updateBot,
  createModelProfile,
  listWorkspaces,
  updateWorkspaceGrants,
  saveWorkflow,
  getWorkflow,
  saveSchedule,
  setScheduleEnabled,
  setScheduleNextRunAt,
  getSettingRaw,
  setSetting,
  listSettingKeys,
  deleteSetting,
  StorageError,
} from "./index.js";
import {
  makeBot,
  makeLayout,
  makeSchedule,
  makeTempRoot,
  makeWorkflow,
  openTestDatabase,
  seedProfileAndWorkspace,
} from "./test-support.js";

describe("bot repository", () => {
  it("creates and reads back a bot", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { profile, workspaceId } = seedProfileAndWorkspace(db);
    const bot = makeBot(profile, workspaceId);
    const result = createBot(db, { bot });
    expect(result.created).toBe(true);
    expect(getBot(db, bot.id)).toEqual(bot);
    db.close();
  });

  it("deduplicates create by requestId and returns the existing bot", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { profile, workspaceId } = seedProfileAndWorkspace(db);
    const requestId = randomUUID();
    const first = createBot(db, { bot: makeBot(profile, workspaceId), requestId });
    const second = createBot(db, {
      bot: makeBot(profile, workspaceId, { name: "另一个" }),
      requestId,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.bot.id).toBe(first.bot.id);
    expect(second.bot.name).not.toBe("另一个");
    db.close();
  });

  it("rejects a bot referencing a missing profile or workspace", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { profile, workspaceId } = seedProfileAndWorkspace(db);
    expect(() =>
      createBot(db, { bot: makeBot(profile, randomUUID()) }),
    ).toThrow(/workspace/);
    expect(() =>
      createBot(db, { bot: makeBot(profile, workspaceId, { modelProfileId: randomUUID() }) }),
    ).toThrow(/model profile/);
    db.close();
  });

  it("guards updates with expectedRevision and rotates the revision", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { profile, workspaceId } = seedProfileAndWorkspace(db);
    const bot = makeBot(profile, workspaceId);
    createBot(db, { bot });

    expect(() =>
      updateBot(db, { id: bot.id, expectedRevision: randomUUID(), patch: { name: "x" } }),
    ).toThrow(StorageError);
    try {
      updateBot(db, { id: bot.id, expectedRevision: randomUUID(), patch: { name: "x" } });
    } catch (error) {
      expect((error as StorageError).code).toBe("REVISION_CONFLICT");
      expect((error as StorageError).details["currentRevision"]).toBe(bot.revision);
    }

    const updated = updateBot(db, {
      id: bot.id,
      expectedRevision: bot.revision,
      patch: { name: "改名了" },
    });
    expect(updated.revision).not.toBe(bot.revision);
    expect(updated.name).toBe("改名了");
    expect(getBot(db, bot.id)?.revision).toBe(updated.revision);
    db.close();
  });

  it("archives idempotently and keeps history readable", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { profile, workspaceId } = seedProfileAndWorkspace(db);
    const bot = makeBot(profile, workspaceId);
    createBot(db, { bot });

    const archived = archiveBot(db, { id: bot.id, expectedRevision: bot.revision });
    expect(archived.archivedAt).not.toBeNull();
    expect(listBots(db)).toHaveLength(0);
    expect(listBots(db, { includeArchived: true })).toHaveLength(1);

    const again = archiveBot(db, {
      id: bot.id,
      expectedRevision: archived.revision,
    });
    expect(again.archivedAt).toEqual(archived.archivedAt);
    db.close();
  });
});

describe("model profile and workspace repositories", () => {
  it("requires a registered credential ref for profiles", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { profile } = seedProfileAndWorkspace(db);
    // The seed already created this profile; re-creating is idempotent.
    expect(createModelProfile(db, profile).created).toBe(false);
    // A second profile may share the same credential ref.
    expect(
      createModelProfile(db, { ...profile, id: randomUUID() }).created,
    ).toBe(true);

    const orphan = { ...profile, id: randomUUID(), credentialRef: "cred:missing" };
    expect(() => createModelProfile(db, orphan)).toThrow(/credential/);
    db.close();
  });

  it("creates workspaces and updates grants", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { workspaceId } = seedProfileAndWorkspace(db);
    const workspace = getWorkspaceOrThrow(db, workspaceId);
    expect(workspace.canonicalPath).toBe("D:\\workspaces\\demo");
    const updated = updateWorkspaceGrants(db, {
      id: workspaceId,
      grants: [{ scopePath: "D:\\workspaces\\demo", operations: ["read", "write"] }],
    });
    expect(updated.grants).toHaveLength(1);
    expect(listWorkspaces(db)).toHaveLength(1);
    db.close();
  });
});

describe("workflow repository", () => {
  it("saves a valid workflow and rejects a cyclic graph", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const cycle = makeWorkflow({
      nodes: [
        { id: "a", type: "bot", botId: randomUUID(), instructionTemplate: "1", inputBindings: [], retryPolicy: { maxRetries: 0 } },
        { id: "b", type: "bot", botId: randomUUID(), instructionTemplate: "2", inputBindings: [{ inputKey: "x", required: true }], retryPolicy: { maxRetries: 0 } },
      ],
      edges: [
        { fromNodeId: "a", outputKey: "out", toNodeId: "b", inputKey: "x" },
        { fromNodeId: "b", outputKey: "out", toNodeId: "a", inputKey: "y" },
      ],
    });
    try {
      saveWorkflow(db, cycle);
      expect.fail("expected cycle rejection");
    } catch (error) {
      expect((error as StorageError).code).toBe("INVALID_INPUT");
      expect(JSON.stringify((error as StorageError).details)).toContain("WORKFLOW_CYCLE");
    }

    const workflow = makeWorkflow();
    const saved = saveWorkflow(db, workflow);
    expect(saved.created).toBe(true);
    expect(getWorkflow(db, workflow.id)).toEqual(workflow);
    db.close();
  });

  it("requires expectedRevision on update and rejects stale revisions", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const workflow = makeWorkflow();
    saveWorkflow(db, workflow);

    try {
      saveWorkflow(db, { ...workflow, name: "改名" });
      expect.fail("expected missing expectedRevision rejection");
    } catch (error) {
      expect((error as StorageError).code).toBe("INVALID_INPUT");
      expect((error as StorageError).message).toMatch(/expectedRevision/);
    }

    const updated = saveWorkflow(db, { ...workflow, name: "改名" }, {
      expectedRevision: workflow.revision,
    });
    expect(updated.created).toBe(false);
    expect(updated.workflow.name).toBe("改名");
    expect(updated.workflow.revision).not.toBe(workflow.revision);

    expect(() =>
      saveWorkflow(db, { ...workflow, name: "再改" }, { expectedRevision: workflow.revision }),
    ).toThrow(StorageError);
    db.close();
  });
});

describe("schedule repository", () => {
  it("upserts schedules and toggles enabled state", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const workflow = saveWorkflow(db, makeWorkflow()).workflow;
    const schedule = makeSchedule(workflow.id);
    saveSchedule(db, schedule);
    saveSchedule(db, { ...schedule, recurrence: "30 8 * * *" });

    expect(setScheduleEnabled(db, { id: schedule.id, enabled: false }).enabled).toBe(false);
    expect(
      setScheduleNextRunAt(db, { id: schedule.id, nextRunAt: "2026-10-25T01:00:00.000Z" }).nextRunAt,
    ).toBe("2026-10-25T01:00:00.000Z");

    expect(() => saveSchedule(db, makeSchedule(randomUUID()))).toThrow(/workflow/);
    db.close();
  });
});

describe("settings store", () => {
  it("round-trips JSON values", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    setSetting(db, "ui.theme", "dark");
    expect(getSettingRaw(db, "ui.theme")).toBe("dark");
    setSetting(db, "ui.theme", { mode: "light" });
    expect(getSettingRaw(db, "ui.theme")).toEqual({ mode: "light" });
    expect(listSettingKeys(db)).toEqual(["ui.theme"]);
    expect(deleteSetting(db, "ui.theme")).toBe(true);
    expect(getSettingRaw(db, "ui.theme")).toBeUndefined();
    db.close();
  });
});

function getWorkspaceOrThrow(
  db: ReturnType<typeof openTestDatabase>,
  id: string,
) {
  const workspace = listWorkspaces(db).find((candidate) => candidate.id === id);
  if (workspace === undefined) {
    throw new Error("workspace missing from fixture");
  }
  return workspace;
}

describe("model profile read and update paths", () => {
  it("lists and updates profiles", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { profile } = seedProfileAndWorkspace(db);
    expect(getModelProfile(db, profile.id)?.model).toBe("deepseek-chat");
    expect(getModelProfile(db, randomUUID())).toBeUndefined();
    expect(listModelProfiles(db)).toHaveLength(1);
    const updated = updateModelProfile(db, {
      id: profile.id,
      patch: { model: "deepseek-reasoner" },
    });
    expect(updated.model).toBe("deepseek-reasoner");
    expect(updated.endpoint).toBe(profile.endpoint);
    expect(() =>
      updateModelProfile(db, { id: randomUUID(), patch: { model: "x" } }),
    ).toThrow(/not found/);
    db.close();
  });
});

describe("schedule read paths", () => {
  it("gets and filters schedules", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const workflow = saveWorkflow(db, makeWorkflow()).workflow;
    const schedule = makeSchedule(workflow.id);
    saveSchedule(db, schedule);
    saveSchedule(db, { ...schedule, id: randomUUID(), enabled: false });

    expect(getSchedule(db, schedule.id)?.recurrence).toBe("0 9 * * 1-5");
    expect(getSchedule(db, randomUUID())).toBeUndefined();
    expect(listSchedules(db, { workflowId: workflow.id })).toHaveLength(2);
    expect(listSchedules(db, { enabledOnly: true })).toHaveLength(1);
    expect(listSchedules(db, { workflowId: randomUUID() })).toHaveLength(0);
    expect(() =>
      setScheduleEnabled(db, { id: randomUUID(), enabled: true }),
    ).toThrow(/not found/);
    expect(() =>
      setScheduleNextRunAt(db, { id: randomUUID(), nextRunAt: null }),
    ).toThrow(/not found/);
    db.close();
  });
});

describe("settings validation", () => {
  it("refuses empty keys", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    expect(() => setSetting(db, "", 1)).toThrow(/empty/);
    db.close();
  });
});

describe("workspace guard branches", () => {
  it("rejects grant updates for unknown workspaces", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    expect(() =>
      updateWorkspaceGrants(db, { id: randomUUID(), grants: [] }),
    ).toThrow(/not found/);
    db.close();
  });
});

describe("model profile limits patch", () => {
  it("updates limits explicitly", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { profile } = seedProfileAndWorkspace(db);
    const updated = updateModelProfile(db, {
      id: profile.id,
      patch: { limits: { maxTokens: 4096 } },
    });
    expect(updated.limits).toEqual({ maxTokens: 4096 });
    db.close();
  });
});

describe("settings delete edge", () => {
  it("reports false when deleting a missing key", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    expect(deleteSetting(db, "missing.key")).toBe(false);
    db.close();
  });
});
