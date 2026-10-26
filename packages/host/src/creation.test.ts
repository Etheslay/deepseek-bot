/**
 * D15 write-layer handler tests (FR-12): the batch method is atomic and
 * assigns pool-distinct avatars, revoke archives exactly what the batch
 * created (including a minted group) and refuses a second pass, and
 * idempotencyKey replays return the original batch.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createHost, type DeepSeekBotHost } from "./host.js";

const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];
afterAll(async () => {
  for (const host of hosts.splice(0)) {
    await host.shutdown().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function makeHost(): Promise<DeepSeekBotHost> {
  const root = mkdtempSync(join(tmpdir(), "dsb-host-creation-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "sk-test-not-used",
  });
  hosts.push(host);
  return host;
}

function seededRefs(host: DeepSeekBotHost): {
  modelProfileId: string;
  workspaceId: string;
  toolPolicyId: string;
} {
  // createHost seeds usable defaults for fresh installs; the batch handler
  // validates references through the same checks as bot.create.
  const profile = host.db.raw
    .prepare("SELECT id FROM model_profiles LIMIT 1;")
    .get() as { id: string };
  const workspace = host.db.raw
    .prepare("SELECT id FROM workspaces LIMIT 1;")
    .get() as { id: string };
  const policy = host.db.raw
    .prepare("SELECT id FROM tool_policies LIMIT 1;")
    .get() as { id: string };
  return {
    modelProfileId: profile.id,
    workspaceId: workspace.id,
    toolPolicyId: policy.id,
  };
}

describe("D15 write-layer handlers", () => {
  it("creates a group and lists it", async () => {
    const host = await makeHost();
    const group = (await host.handleMethod("group.create", {
      name: "research-squad",
    })) as { id: string; name: string; archivedAt: null };
    expect(group.name).toBe("research-squad");
    expect((await host.handleMethod("group.list", {})) as unknown).toEqual({
      groups: [group],
    });
  });

  it("batch-creates a group with distinct avatars and revokes the whole batch", async () => {
    const host = await makeHost();
    const refs = seededRefs(host);

    const batch = (await host.handleMethod("bot.batchCreate", {
      newGroup: { name: "squad" },
      defaults: refs,
      bots: [
        { name: "scout", instructions: "Look around." },
        {
          name: "artist",
          instructions: "Draw.",
          avatar: { shape: "heart", color: "#e8483f" },
        },
        { name: "writer", instructions: "Write." },
      ],
    })) as {
      batchId: string;
      group: { id: string; name: string };
      bots: Array<{ id: string; avatar: { shape: string; color: string } }>;
    };

    expect(batch.group).toMatchObject({ name: "squad" });
    expect(batch.bots).toHaveLength(3);
    expect(batch.bots[1]!.avatar).toEqual({ shape: "heart", color: "#e8483f" });
    const keys = new Set(batch.bots.map((b) => `${b.avatar.shape}:${b.avatar.color}`));
    expect(keys.size).toBe(3);

    const revoke = (await host.handleMethod("creation.revoke", {
      batchId: batch.batchId,
    })) as { revokedBotIds: string[]; revokedGroupId: string | null };
    expect(revoke.revokedBotIds).toEqual(batch.bots.map((b) => b.id));
    expect(revoke.revokedGroupId).toBe(batch.group.id);
    expect(
      (await host.handleMethod("group.list", {})) as { groups: unknown[] },
    ).toEqual({ groups: [] });

    // A second revoke of the same batch is rejected.
    await expect(
      host.handleMethod("creation.revoke", { batchId: batch.batchId }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("avoids the avatars of members already in the target group", async () => {
    const host = await makeHost();
    const refs = seededRefs(host);

    const first = (await host.handleMethod("bot.batchCreate", {
      newGroup: { name: "squad" },
      defaults: refs,
      bots: [{ name: "a", instructions: "x" }, { name: "b", instructions: "x" }],
    })) as { group: { id: string }; bots: Array<{ avatar: { shape: string; color: string } }> };

    const second = (await host.handleMethod("bot.batchCreate", {
      groupId: first.group.id,
      defaults: refs,
      bots: [{ name: "c", instructions: "x" }],
    })) as { bots: Array<{ avatar: { shape: string; color: string } }> };

    const firstKeys = new Set(
      first.bots.map((b) => `${b.avatar.shape}:${b.avatar.color}`),
    );
    const secondAvatar = second.bots[0]!.avatar;
    expect(
      firstKeys.has(`${secondAvatar.shape}:${secondAvatar.color}`),
    ).toBe(false);
  });

  it("replays a duplicate idempotencyKey without duplicating bots", async () => {
    const host = await makeHost();
    const refs = seededRefs(host);
    const idempotencyKey = randomUUID();
    const request = {
      defaults: refs,
      bots: [{ name: "solo", instructions: "x" }],
      idempotencyKey,
    };
    const first = (await host.handleMethod("bot.batchCreate", request)) as {
      batchId: string;
      bots: Array<{ id: string }>;
    };
    const second = (await host.handleMethod("bot.batchCreate", request)) as {
      batchId: string;
      bots: Array<{ id: string }>;
    };
    expect(second.batchId).toBe(first.batchId);
    expect(second.bots.map((b) => b.id)).toEqual(first.bots.map((b) => b.id));
    expect((await host.handleMethod("bot.list", {})) as { bots: unknown[] }).toEqual({
      bots: first.bots,
    });
  });

  it("rejects batch bots that resolve no profile/workspace", async () => {
    const host = await makeHost();
    await expect(
      host.handleMethod("bot.batchCreate", {
        bots: [{ name: "broken", instructions: "x" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await host.handleMethod("bot.list", {})) as { bots: unknown[] }).toEqual({
      bots: [],
    });
  });

  it("rejects groupId and newGroup together and unknown target groups", async () => {
    const host = await makeHost();
    const refs = seededRefs(host);
    const payload = {
      defaults: refs,
      bots: [{ name: "x", instructions: "x" }],
    };
    await expect(
      host.handleMethod("bot.batchCreate", {
        ...payload,
        groupId: randomUUID(),
        newGroup: { name: "clash" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("bot.batchCreate", {
        ...payload,
        groupId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("bot.create accepts an explicit avatar and groupId, bot.update clears them", async () => {
    const host = await makeHost();
    const refs = seededRefs(host);
    const group = (await host.handleMethod("group.create", {
      name: "g",
    })) as { id: string };
    const bot = (await host.handleMethod("bot.create", {
      name: "solo",
      instructions: "x",
      ...refs,
      avatar: { shape: "star5", color: "#3b93f0" },
      groupId: group.id,
    })) as { id: string; revision: string; avatar: unknown; groupId: string };
    expect(bot.avatar).toEqual({ shape: "star5", color: "#3b93f0" });
    expect(bot.groupId).toBe(group.id);

    const cleared = (await host.handleMethod("bot.update", {
      id: bot.id,
      expectedRevision: bot.revision,
      patch: { avatar: null, groupId: null },
    })) as { avatar: unknown; groupId: unknown };
    expect(cleared.avatar).toBeUndefined();
    expect(cleared.groupId).toBeUndefined();

    await expect(
      host.handleMethod("bot.create", {
        name: "ghost",
        instructions: "x",
        ...refs,
        groupId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
