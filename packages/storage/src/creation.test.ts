/**
 * D15 write-layer storage: bot groups, avatar/group columns on bots and the
 * creation batch ledger behind creation.revoke.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Bot } from "@deepseek-bot/contracts";
import {
  archiveBot,
  archiveGroup,
  createBot,
  createBotBatch,
  createGroup,
  getBatch,
  getBatchByRequestId,
  getBot,
  getGroup,
  insertBatch,
  listBots,
  listBotsInGroup,
  listGroups,
  markBatchRevoked,
  updateBot,
} from "./index.js";
import {
  makeBot,
  makeLayout,
  makeTempRoot,
  openTestDatabase,
  seedProfileAndWorkspace,
} from "./test-support.js";

function makeGroup(overrides: { name?: string } = {}) {
  return {
    id: randomUUID(),
    revision: randomUUID(),
    name: overrides.name ?? "research-squad",
    archivedAt: null,
  };
}

describe("group repository", () => {
  it("creates, reads and lists non-archived groups", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const group = makeGroup();
    expect(createGroup(db, { group })).toEqual(group);
    expect(getGroup(db, group.id)).toEqual(group);
    expect(createGroup(db, { group: makeGroup({ name: "ops" }) }));
    expect([...listGroups(db).map((g) => g.name)].sort()).toEqual([
      "ops",
      "research-squad",
    ]);

    const archived = archiveGroup(db, {
      id: group.id,
      expectedRevision: group.revision,
    });
    expect(archived.archivedAt).not.toBeNull();
    expect(listGroups(db).map((g) => g.name)).toEqual(["ops"]);
    db.close();
  });

  it("archives idempotently with a matching revision and rejects stale ones", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const group = makeGroup();
    createGroup(db, { group });
    const first = archiveGroup(db, {
      id: group.id,
      expectedRevision: group.revision,
    });
    expect(
      archiveGroup(db, { id: group.id, expectedRevision: first.revision }),
    ).toEqual(first);
    expect(() =>
      archiveGroup(db, { id: group.id, expectedRevision: group.revision }),
    ).toThrowError(/modified by someone else/);
    db.close();
  });
});

describe("bot avatar and group columns", () => {
  it("persists avatar and groupId and filters members per group", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { profile, workspaceId } = seedProfileAndWorkspace(db);
    const group = makeGroup();
    createGroup(db, { group });

    const member = makeBot(profile, workspaceId, {
      avatar: { shape: "star5", color: "#3b93f0" },
      groupId: group.id,
    });
    const outsider = makeBot(profile, workspaceId);
    createBot(db, { bot: member });
    createBot(db, { bot: outsider });

    expect(getBot(db, member.id)).toEqual(member);
    expect(getBot(db, outsider.id)).toEqual(outsider);
    expect(listBotsInGroup(db, group.id).map((b) => b.id)).toEqual([
      member.id,
    ]);
    expect([...listBots(db).map((b) => b.id)].sort()).toEqual(
      [member.id, outsider.id].sort(),
    );

    const archived = archiveBot(db, {
      id: member.id,
      expectedRevision: member.revision,
    });
    expect(listBotsInGroup(db, group.id)).toEqual([]);
    expect(listBotsInGroup(db, group.id, { includeArchived: true })).toEqual([
      archived,
    ]);
    db.close();
  });

  it("updates avatar and groupId through the revision-guarded patch", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { profile, workspaceId } = seedProfileAndWorkspace(db);
    const group = makeGroup();
    createGroup(db, { group });
    const bot = makeBot(profile, workspaceId);
    createBot(db, { bot });

    const updated = updateBot(db, {
      id: bot.id,
      expectedRevision: bot.revision,
      patch: {
        avatar: { shape: "egg", color: "#f0b429" },
        groupId: group.id,
      },
    });
    expect(updated.avatar).toEqual({ shape: "egg", color: "#f0b429" });
    expect(updated.groupId).toBe(group.id);
    expect(getBot(db, bot.id)?.avatar).toEqual({ shape: "egg", color: "#f0b429" });

    const cleared = updateBot(db, {
      id: bot.id,
      expectedRevision: updated.revision,
      patch: { avatar: null, groupId: null },
    });
    expect(cleared.avatar).toBeUndefined();
    expect(cleared.groupId).toBeUndefined();
    expect(getBot(db, bot.id)?.avatar).toBeUndefined();
    db.close();
  });
});

describe("creation batch ledger", () => {
  it("inserts, reads by id and by requestId", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const botIds = [randomUUID(), randomUUID()];
    const requestId = randomUUID();
    const batch = insertBatch(db, {
      id: randomUUID(),
      groupId: null,
      createdGroupId: null,
      botIds,
      requestId,
    });
    expect(getBatch(db, batch.id)?.botIds).toEqual(botIds);
    expect(getBatchByRequestId(db, requestId)?.id).toBe(batch.id);
    expect(getBatchByRequestId(db, randomUUID())).toBeUndefined();
    db.close();
  });

  it("marks revoked once and refuses a second revoke", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const batch = insertBatch(db, {
      id: randomUUID(),
      groupId: null,
      createdGroupId: null,
      botIds: [randomUUID()],
      requestId: null,
    });
    expect(markBatchRevoked(db, batch.id).revokedAt).not.toBeNull();
    expect(() => markBatchRevoked(db, batch.id)).toThrowError(
      /already revoked/,
    );
    db.close();
  });
});

describe("transactional batch creation", () => {
  const profileId = "44444444-4444-4444-8444-444444444444";
  let workspaceId = "";

  function batchBot(name: string, overrides: Partial<Bot> = {}): Bot {
    return {
      id: randomUUID(),
      revision: randomUUID(),
      name,
      instructions: `${name} 的指令。`,
      modelProfileId: profileId,
      workspaceId,
      toolPolicyId: "66666666-6666-4666-8666-666666666666",
      role: "standard",
      archivedAt: null,
      ...overrides,
    };
  }

  function seed() {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    workspaceId = seedProfileAndWorkspace(db, { profileId }).workspaceId;
    return db;
  }

  it("creates group and members atomically with distinct avatars", () => {
    const db = seed();
    const group = makeGroup();
    const result = createBotBatch(db, {
      batchId: randomUUID(),
      newGroup: group,
      bots: [
        { bot: batchBot("scout") },
        { bot: batchBot("analyst"), avatar: { shape: "egg", color: "#f0b429" } },
        { bot: batchBot("writer") },
      ],
    });
    expect(result.group).toEqual(group);
    expect(result.bots).toHaveLength(3);
    const keys = new Set(result.bots.map((b) => `${b.avatar!.shape}:${b.avatar!.color}`));
    expect(keys.size).toBe(3);
    expect(result.bots.every((b) => b.groupId === group.id)).toBe(true);
    expect(getGroup(db, group.id)).toEqual(group);

    // The second batch into the same group avoids every member avatar.
    const second = createBotBatch(db, {
      batchId: randomUUID(),
      groupId: group.id,
      bots: [{ bot: batchBot("latecomer") }],
    });
    const secondAvatar = second.bots[0]!.avatar!;
    expect(keys.has(`${secondAvatar.shape}:${secondAvatar.color}`)).toBe(false);
    db.close();
  });

  it("replays a duplicate idempotencyKey instead of duplicating bots", () => {
    const db = seed();
    const requestId = randomUUID();
    const first = createBotBatch(db, {
      batchId: randomUUID(),
      requestId,
      bots: [{ bot: batchBot("scout") }],
    });
    const second = createBotBatch(db, {
      batchId: randomUUID(),
      requestId,
      bots: [{ bot: batchBot("scout") }],
    });
    expect(second.bots.map((b) => b.id)).toEqual(first.bots.map((b) => b.id));
    expect(listBots(db)).toHaveLength(1);
    db.close();
  });

  it("rolls the whole batch back when a member fails validation", () => {
    const db = seed();
    const group = makeGroup();
    expect(() =>
      createBotBatch(db, {
        batchId: randomUUID(),
        newGroup: group,
        bots: [
          { bot: batchBot("fine") },
          { bot: batchBot("broken", { workspaceId: randomUUID() }) },
        ],
      }),
    ).toThrowError(/workspace does not exist/);
    expect(getGroup(db, group.id)).toBeUndefined();
    expect(listBots(db)).toEqual([]);
    db.close();
  });
});
