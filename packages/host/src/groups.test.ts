/**
 * Host surface for the persisted sidebar groups (G1' 分组实体化, protocol
 * v0.14): create/list plus the new archive method with optimistic concurrency
 * and idempotent re-archiving. Member moves ride bot.update's groupId patch
 * and are covered by the bot suites.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { BotGroup } from "@deepseek-bot/contracts";
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
  const root = mkdtempSync(join(tmpdir(), "dsb-host-groups-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    dshBin: fileURLToPath(
      new URL("../../harness-adapter/src/testing/fake-harness.mjs", import.meta.url),
    ),
    childEnv: (env) => ({ ...env, FAKE_SCENARIO: "ok" }),
    resolveApiKey: async () => "sk-test-not-used",
  });
  hosts.push(host);
  return host;
}

describe("group methods", () => {
  it("creates, lists, archives and hides the group from listings", async () => {
    const host = await makeHost();
    const created = (await host.handleMethod("group.create", {
      name: "设计组",
    })) as BotGroup;
    expect(created.name).toBe("设计组");
    expect(created.archivedAt).toBeNull();

    const listed = (await host.handleMethod("group.list", {})) as {
      groups: BotGroup[];
    };
    expect(listed.groups).toEqual([created]);

    const archived = (await host.handleMethod("group.archive", {
      id: created.id,
      expectedRevision: created.revision,
    })) as BotGroup;
    expect(archived.id).toBe(created.id);
    expect(archived.archivedAt).not.toBeNull();

    const afterArchive = (await host.handleMethod("group.list", {})) as {
      groups: BotGroup[];
    };
    expect(afterArchive.groups).toEqual([]);
  });

  it("re-archiving via the returned revision echoes the archived group", async () => {
    const host = await makeHost();
    const created = (await host.handleMethod("group.create", {
      name: "一次就好",
    })) as BotGroup;
    const first = (await host.handleMethod("group.archive", {
      id: created.id,
      expectedRevision: created.revision,
    })) as BotGroup;
    // Archive rotates the revision, so the retry must address the archived
    // group by the revision the first call returned (optimistic concurrency).
    const second = (await host.handleMethod("group.archive", {
      id: created.id,
      expectedRevision: first.revision,
    })) as BotGroup;
    expect(second).toEqual(first);
  });

  it("rejects unknown ids and stale revisions", async () => {
    const host = await makeHost();
    const created = (await host.handleMethod("group.create", {
      name: "并发组",
    })) as BotGroup;
    await expect(
      host.handleMethod("group.archive", {
        id: "99999999-9999-4999-8999-999999999999",
        expectedRevision: created.revision,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("group.archive", {
        id: created.id,
        expectedRevision: "99999999-9999-4999-8999-999999999999",
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
});
