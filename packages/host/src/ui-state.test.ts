/**
 * Host surface for the persisted interface state (G1', protocol v0.13):
 * snapshot get/set with contract validation, and fail-safe degradation for a
 * corrupt settings row. Renderer wiring is covered by the desktop suites.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { UiState } from "@deepseek-bot/contracts";
import { setSetting } from "@deepseek-bot/storage";
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
  const root = mkdtempSync(join(tmpdir(), "dsb-host-ui-state-"));
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

const botId = "11111111-1111-4111-8111-111111111111";
const groupId = "77777777-7777-4777-8777-777777777777";

describe("ui.state methods", () => {
  it("answers the empty state before anything is stored", async () => {
    const host = await makeHost();
    const response = (await host.handleMethod("ui.state.get", {})) as {
      state: UiState;
    };
    expect(response.state).toEqual({
      botOrder: [],
      groupOrder: [],
      selectedBotId: null,
      selectedGroupId: null,
    });
  });

  it("round-trips a save, echoes it, and replaces on the next save", async () => {
    const host = await makeHost();
    const first: UiState = {
      botOrder: [botId],
      groupOrder: [],
      selectedBotId: botId,
      selectedGroupId: null,
    };
    const saved = (await host.handleMethod("ui.state.set", {
      state: first,
    })) as { state: UiState };
    expect(saved.state).toEqual(first);
    const read = (await host.handleMethod("ui.state.get", {})) as {
      state: UiState;
    };
    expect(read.state).toEqual(first);

    const second: UiState = {
      botOrder: [],
      groupOrder: [groupId],
      selectedBotId: null,
      selectedGroupId: groupId,
    };
    await host.handleMethod("ui.state.set", { state: second });
    const replaced = (await host.handleMethod("ui.state.get", {})) as {
      state: UiState;
    };
    expect(replaced.state).toEqual(second);
  });

  it("rejects payloads the schema refuses with INVALID_INPUT", async () => {
    const host = await makeHost();
    await expect(
      host.handleMethod("ui.state.set", {
        state: { ...{ botOrder: [], groupOrder: [], selectedBotId: null, selectedGroupId: null }, apiKey: "secret" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("ui.state.set", {
        state: { botOrder: ["not-a-uuid"], groupOrder: [], selectedBotId: null, selectedGroupId: null },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("ui.state.set", {}),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // The failed writes left the stored state untouched.
    const read = (await host.handleMethod("ui.state.get", {})) as {
      state: UiState;
    };
    expect(read.state).toEqual({
      botOrder: [],
      groupOrder: [],
      selectedBotId: null,
      selectedGroupId: null,
    });
  });

  it("degrades a corrupt settings row to the empty state", async () => {
    const host = await makeHost();
    setSetting(host.db, "ui.state.v1", { botOrder: "junk", selectedBotId: 7 });
    const read = (await host.handleMethod("ui.state.get", {})) as {
      state: UiState;
    };
    expect(read.state).toEqual({
      botOrder: [],
      groupOrder: [],
      selectedBotId: null,
      selectedGroupId: null,
    });
  });
});
