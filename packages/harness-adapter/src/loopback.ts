import { randomInt } from "node:crypto";
import type { Server } from "node:http";

/** Avoid Fetch's bad-port list even on machines with a custom ephemeral range. */
export async function listenOnPrivateHttpPort(server: Server): Promise<void> {
  for (let attempt = 0; attempt < 16; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => {
          server.off("listening", ready);
          reject(error);
        };
        const ready = () => {
          server.off("error", failed);
          resolve();
        };
        server.once("error", failed);
        server.once("listening", ready);
        server.listen(randomInt(49152, 65536), "127.0.0.1");
      });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" && code !== "EACCES") throw error;
    }
  }
  throw new Error("local HTTP port allocation failed");
}
