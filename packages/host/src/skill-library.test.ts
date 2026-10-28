/**
 * Host surface for the persisted skill library (D17', protocol v0.11):
 * whole-library get/save with contract validation, and fail-safe degradation
 * for a corrupt settings row. Injection is covered by the chat suites.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { SkillLibrary } from "@deepseek-bot/contracts";
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
  const root = mkdtempSync(join(tmpdir(), "dsb-host-skill-library-"));
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

function skill(id: string, name: string): SkillLibrary["skills"][number] {
  return {
    id,
    name,
    instructions: "输出三段式周报。",
    capabilities: ["fs.read"],
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function library(n: number): SkillLibrary {
  const skills = Array.from({ length: n }, (_, index) =>
    skill(
      `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      `技能 ${index}`,
    ),
  );
  return { skills, bindings: {} };
}

describe("skill library methods", () => {
  it("answers an empty library before anything is stored", async () => {
    const host = await makeHost();
    const response = (await host.handleMethod("skillLibrary.get", {})) as {
      library: SkillLibrary;
    };
    expect(response.library).toEqual({ skills: [], bindings: {} });
  });

  it("round-trips a save, echoes it, and replaces on the next save", async () => {
    const host = await makeHost();
    const first = library(2);
    const saved = (await host.handleMethod("skillLibrary.save", {
      library: first,
    })) as { library: SkillLibrary };
    expect(saved.library).toEqual(first);
    const read = (await host.handleMethod("skillLibrary.get", {})) as {
      library: SkillLibrary;
    };
    expect(read.library).toEqual(first);

    const second = library(1);
    await host.handleMethod("skillLibrary.save", { library: second });
    const replaced = (await host.handleMethod("skillLibrary.get", {})) as {
      library: SkillLibrary;
    };
    expect(replaced.library).toEqual(second);
  });

  it("keeps bindings and accepts unknown capability strings like the renderer shelf", async () => {
    const host = await makeHost();
    const payload: SkillLibrary = {
      skills: [
        {
          ...skill("11111111-1111-4111-8111-000000000000", "旧技能"),
          capabilities: ["read", "not-a-capability"],
        },
      ],
      bindings: {
        "22222222-2222-4222-8222-222222222222": [
          "11111111-1111-4111-8111-000000000000",
        ],
      },
    };
    await host.handleMethod("skillLibrary.save", { library: payload });
    const read = (await host.handleMethod("skillLibrary.get", {})) as {
      library: SkillLibrary;
    };
    expect(read.library).toEqual(payload);
  });

  it("rejects a library past the cap with INVALID_INPUT", async () => {
    const host = await makeHost();
    await expect(
      host.handleMethod("skillLibrary.save", { library: library(31) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("skillLibrary.save", {
        library: { skills: [{ id: "", name: "坏", instructions: "x", capabilities: [], version: 0, createdAt: 0, updatedAt: 0 }], bindings: {} },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // The failed writes left the stored library untouched.
    const read = (await host.handleMethod("skillLibrary.get", {})) as {
      library: SkillLibrary;
    };
    expect(read.library).toEqual({ skills: [], bindings: {} });
  });

  it("degrades a corrupt settings row to an empty library", async () => {
    const host = await makeHost();
    setSetting(host.db, "skills.library.v1", { skills: "junk", bindings: 7 });
    const read = (await host.handleMethod("skillLibrary.get", {})) as {
      library: SkillLibrary;
    };
    expect(read.library).toEqual({ skills: [], bindings: {} });
  });
});
