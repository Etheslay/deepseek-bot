/**
 * Connector invocation driver (D19): the txt2img action against a fake
 * local SD WebUI server, plus the guard rails (disabled, no endpoint,
 * unreachable, HTTP error, non-JSON, oversized image).
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase, registerConnector, setConnectorEnabled, type OpenedDatabase } from "@deepseek-bot/storage";
import { invokeConnector } from "./connectors.js";

const roots: string[] = [];
const servers: Server[] = [];
afterAll(() => {
  for (const server of servers.splice(0)) server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function tempDb(): OpenedDatabase {
  const root = mkdtempSync(join(tmpdir(), "dsb-conn-driver-"));
  roots.push(root);
  return openDatabase(join(root, "app.sqlite"));
}

/** One-shot fake SD WebUI: answers /sdapi/v1/txt2img per the scenario. */
async function fakeSd(
  handler: (body: unknown) => { status?: number; json?: unknown; raw?: string },
): Promise<{ url: string; bodies: unknown[] }> {
  const bodies: unknown[] = [];
  const server = createServer((request, response) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => {
      bodies.push(JSON.parse(data === "" ? "{}" : data));
      const outcome = handler(bodies[bodies.length - 1]);
      response.writeHead(outcome.status ?? 200, { "content-type": "application/json" });
      response.end(outcome.raw ?? JSON.stringify(outcome.json));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fake SD server did not listen on a port");
  }
  return { url: `http://127.0.0.1:${address.port}`, bodies };
}

async function enabledConnector(
  db: OpenedDatabase,
  endpoint: string | null,
): Promise<string> {
  const row = registerConnector(db, { name: "local-diffusion", endpoint });
  await setConnectorEnabled(db, { id: row.id, enabled: true });
  return row.id;
}

describe("invokeConnector (D19 txt2img)", () => {
  it("posts the render parameters and writes the returned image", async () => {
    const db = tempDb();
    const { url, bodies } = await fakeSd(() => ({ json: { images: [PNG.toString("base64")] } }));
    const connectorId = await enabledConnector(db, url);
    const outputs = mkdtempSync(join(tmpdir(), "dsb-conn-out-"));
    roots.push(outputs);

    const result = await invokeConnector(
      db,
      outputs,
      {
        connectorId,
        action: "txt2img",
        params: { prompt: "一只在云上的机器猫", steps: 15 },
      },
      { now: () => new Date("2026-10-27T00:00:00Z") },
    );
    expect(result).toMatchObject({
      connectorId,
      action: "txt2img",
      sizeBytes: PNG.byteLength,
      at: "2026-10-27T00:00:00.000Z",
    });
    expect(result.savedPath.startsWith(join(outputs, connectorId))).toBe(true);
    expect(readFileSync(result.savedPath)).toEqual(PNG);
    expect(bodies[0]).toMatchObject({
      prompt: "一只在云上的机器猫",
      negative_prompt: "",
      steps: 15,
      batch_size: 1,
    });
    db.close();
  });

  it("refuses disabled connectors, missing endpoints and unknown actions", async () => {
    const db = tempDb();
    const disabled = registerConnector(db, { name: "off", endpoint: "http://127.0.0.1:1" });
    await expect(
      invokeConnector(
        db,
        "unused",
        { connectorId: disabled.id, action: "txt2img", params: { prompt: "x" } },
        { now: () => new Date() },
      ),
    ).rejects.toThrowError(/disabled/);

    const bare = registerConnector(db, { name: "bare" });
    await setConnectorEnabled(db, { id: bare.id, enabled: true });
    await expect(
      invokeConnector(
        db,
        "unused",
        { connectorId: bare.id, action: "txt2img", params: { prompt: "x" } },
        { now: () => new Date() },
      ),
    ).rejects.toThrowError(/no endpoint/);

    const id = await enabledConnector(db, "http://127.0.0.1:1");
    await expect(
      invokeConnector(
        db,
        "unused",
        { connectorId: id, action: "img2img", params: { prompt: "x" } },
        { now: () => new Date() },
      ),
    ).rejects.toThrowError(/unsupported connector action/);
    db.close();
  });

  it("maps transport and response failures to clear errors", async () => {
    const db = tempDb();
    const dead = mkdtempSync(join(tmpdir(), "dsb-conn-dead-"));
    roots.push(dead);
    const unreachable = await enabledConnector(db, "http://127.0.0.1:9");
    await expect(
      invokeConnector(
        db,
        unreachable,
        { connectorId: unreachable, action: "txt2img", params: { prompt: "x" } },
        { now: () => new Date() },
      ).catch((error: Error) => {
        throw new Error(`wrapped:${error.message}`);
      }),
    ).rejects.toThrowError(/unreachable/);
    void dead;

    const failing = await fakeSd(() => ({ status: 500, json: { error: "CUDA out of memory" } }));
    const failingId = await enabledConnector(db, failing.url);
    await expect(
      invokeConnector(
        db,
        "unused",
        { connectorId: failingId, action: "txt2img", params: { prompt: "x" } },
        { now: () => new Date() },
      ),
    ).rejects.toThrowError(/HTTP 500/);

    const garbage = await fakeSd(() => ({ raw: "not json" }));
    const garbageId = await enabledConnector(db, garbage.url);
    await expect(
      invokeConnector(
        db,
        "unused",
        { connectorId: garbageId, action: "txt2img", params: { prompt: "x" } },
        { now: () => new Date() },
      ),
    ).rejects.toThrowError(/non-JSON/);

    const empty = await fakeSd(() => ({ json: { images: [] } }));
    const emptyId = await enabledConnector(db, empty.url);
    await expect(
      invokeConnector(
        db,
        "unused",
        { connectorId: emptyId, action: "txt2img", params: { prompt: "x" } },
        { now: () => new Date() },
      ),
    ).rejects.toThrowError(/no image/);
    db.close();
  });
});
