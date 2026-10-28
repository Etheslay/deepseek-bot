import { createServer, type Server } from "node:http";
import { randomInt } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { listenOnPrivateHttpPort } from "./loopback.js";

vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});
const servers: Server[] = [];
const nextPort = vi.mocked(randomInt as (min: number, max: number) => number);
afterEach(async () => {
  nextPort
    .mockReset()
    .mockImplementation(
      (await vi.importActual<typeof import("node:crypto")>("node:crypto")).randomInt,
    );
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
function ownedServer() {
  const server = createServer((_request, response) => response.end("local"));
  servers.push(server);
  return server;
}
function port(server: Server) {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("not listening");
  return address.port;
}

it("binds fetch-compatible high ports on IPv4 loopback", async () => {
  const server = ownedServer();
  await listenOnPrivateHttpPort(server);
  expect(server.address()).toMatchObject({ address: "127.0.0.1" });
  expect(port(server)).toBeGreaterThanOrEqual(49152);
  expect(await (await fetch(`http://127.0.0.1:${port(server)}`)).text()).toBe("local");
});
it("retries an occupied candidate without leaking listeners", async () => {
  const occupied = ownedServer();
  await listenOnPrivateHttpPort(occupied);
  nextPort.mockReturnValueOnce(port(occupied));
  const server = ownedServer();
  const listeningListeners = server.listenerCount("listening");
  await listenOnPrivateHttpPort(server);
  expect(port(server)).not.toBe(port(occupied));
  expect(server.listenerCount("error")).toBe(0);
  expect(server.listenerCount("listening")).toBe(listeningListeners);
});
it("fails after bounded allocation attempts", async () => {
  const occupied = ownedServer();
  await listenOnPrivateHttpPort(occupied);
  nextPort.mockReturnValue(port(occupied));
  const server = ownedServer();
  const listeningListeners = server.listenerCount("listening");
  await expect(listenOnPrivateHttpPort(server)).rejects.toThrow(
    "local HTTP port allocation failed",
  );
  expect(server.listening).toBe(false);
  expect(server.listenerCount("error")).toBe(0);
  expect(server.listenerCount("listening")).toBe(listeningListeners);
});
