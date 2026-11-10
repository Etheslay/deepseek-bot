/**
 * Turn an Office file into a PDF with the Harness LibreOffice engine.
 *
 * `@deepseek-ai/libreoffice-kit` is the same converter the pinned Harness
 * uses for office-export-pdf. It writes a real PDF (layout and fonts), and
 * refuses to overwrite an existing output, so this helper converts to a
 * private file and then moves it onto the requested path.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ConversionError, createConverter } from "@deepseek-ai/libreoffice-kit";
import { MAX_ATTACHMENT_BYTES } from "@deepseek-bot/contracts";
import { EngineError } from "@deepseek-bot/runtime";

function invalid(message: string): EngineError {
  return new EngineError({ code: "INVALID_INPUT", message, retryable: false });
}

function failure(error: unknown): EngineError {
  if (error instanceof EngineError) return error;
  if (error instanceof ConversionError) {
    if (error.code === "unavailable") {
      return invalid("Harness 的 LibreOffice 引擎不可用，转不成 PDF");
    }
    return invalid(error.message);
  }
  const message = error instanceof Error ? error.message : "转成 PDF 失败";
  return invalid(message);
}

/** Convert one absolute Office file to a PDF at `outputPath`. Returns the PDF size. */
export async function convertOfficeToPdf(inputPath: string, outputPath: string): Promise<number> {
  if (!path.isAbsolute(inputPath) || !path.isAbsolute(outputPath)) {
    throw invalid("office conversion requires absolute paths");
  }
  const temporary = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${randomBytes(4).toString("hex")}.pdf`,
  );
  const converter = await createConverter({
    timeoutMs: 120_000,
    maxOutputBytes: MAX_ATTACHMENT_BYTES,
  });
  try {
    await converter.convert({ inputPath, outputPath: temporary });
    const size = fs.statSync(temporary).size;
    if (size > MAX_ATTACHMENT_BYTES) throw invalid("written PDF exceeds 20 MB");
    if (size < 5) throw invalid("LibreOffice 没有写出 PDF");
    const signature = fs.readFileSync(temporary).subarray(0, 5).toString();
    if (signature !== "%PDF-") {
      throw invalid("LibreOffice 没有写出 PDF");
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.rmSync(outputPath, { force: true });
    fs.renameSync(temporary, outputPath);
    return size;
  } catch (error) {
    throw failure(error);
  } finally {
    fs.rmSync(temporary, { force: true });
    await converter.dispose();
  }
}
