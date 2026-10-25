/**
 * Audit sinks (D15): in-memory for tests/UI, JSONL file for the Host
 * (append-only, one record per line — the trace of everything the gateway
 * did). Full parameter/result values never enter the audit trail; records
 * carry digests only.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditRecord, AuditSink } from "./types.js";

export class MemoryAuditSink implements AuditSink {
  readonly records: AuditRecord[] = [];

  append(record: AuditRecord): void {
    this.records.push(record);
  }
}

export class JsonlAuditSink implements AuditSink {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  append(record: AuditRecord): void {
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
