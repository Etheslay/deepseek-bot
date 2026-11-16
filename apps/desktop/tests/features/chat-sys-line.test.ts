// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../src/renderer/src/styles.css"),
  "utf8",
);

describe("chat permission status line", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("centers the grant line in the chat column", () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const page = document.createElement("div");
    page.className = "chat-page";
    const chat = document.createElement("div");
    chat.className = "chat";
    const line = document.createElement("p");
    line.className = "sys-line";
    line.textContent = "bot1 本次可以执行本地命令";
    chat.append(line);
    page.append(chat);
    document.body.append(page);
    expect(getComputedStyle(line).textAlign).toBe("center");
  });
});
