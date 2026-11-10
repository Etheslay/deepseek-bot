/**
 * Run a pptxgenjs body that a GitHub skill asked the model to write.
 * The script sees only `pres`. It cannot import, read the disk, or save the file.
 */
import vm from "node:vm";
import PptxGenJSImport from "pptxgenjs";
import { EngineError } from "@deepseek-bot/runtime";

interface PresentationFile {
  layout: string;
  write(options: { outputType: "nodebuffer" }): Promise<Uint8Array>;
}

const PptxGenJS = PptxGenJSImport as unknown as new () => PresentationFile;

const BANNED =
  /\b(?:require|import|process|globalThis|Function|eval|fetch|writeFile|XMLHttpRequest|child_process)\b/;

function invalid(message: string): EngineError {
  return new EngineError({ code: "INVALID_INPUT", message, retryable: false });
}

/** Build one deck from script statements that use the provided `pres`. */
export async function renderPptxScript(script: string): Promise<Uint8Array> {
  const body = script.trim();
  if (body.length < 40 || body.length > 24_000) {
    throw invalid("presentation script must be a pptxgenjs body");
  }
  if (BANNED.test(body)) {
    throw invalid("presentation script can only draw slides on pres");
  }
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  try {
    vm.runInNewContext(`"use strict";\n${body}`, vm.createContext({ pres }), { timeout: 5_000 });
  } catch {
    throw invalid("presentation script failed while building slides");
  }
  const written = await pres.write({ outputType: "nodebuffer" });
  const bytes = written instanceof Uint8Array ? new Uint8Array(written) : new Uint8Array();
  if (bytes.byteLength < 4 || Buffer.from(bytes.subarray(0, 2)).toString() !== "PK") {
    throw invalid("presentation script did not produce a PowerPoint file");
  }
  return bytes;
}
