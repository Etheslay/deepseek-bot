import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ToolRejectionError,
  type GatewayRejectionCode,
  type ToolCapability,
  type ToolContext,
} from "./types.js";

export const WebSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(512),
    maxResults: z.int().min(1).max(10).default(5),
  })
  .strict();
type SearchInput = z.output<typeof WebSearchInputSchema>;

export interface WebSearchOptions {
  /** Full SearXNG /search (or /) endpoint. No implicit public service. */
  readonly endpoint?: string;
  /** HTTP timeout, including body consumption; default 15 seconds. */
  readonly timeoutMs?: number;
}

export interface WebSearchResult {
  readonly provider: "searxng";
  readonly query: string;
  readonly results: Array<{ title: string; url: string; snippet: string }>;
  readonly warnings: string[];
}

const providerResponse = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string(), content: z.string().nullish() })),
  unresponsive_engines: z.array(z.unknown()).optional(),
});
const MAX_RESPONSE_BYTES = 1_048_576;
const HOST_CLOSED = Symbol("search host closed");
const TIMED_OUT = Symbol("search timed out");

function unavailable(message = "web_search provider is unavailable"): ToolRejectionError {
  return new ToolRejectionError("RUNTIME_UNAVAILABLE", message);
}

function parseEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ToolRejectionError("INVALID_INPUT", "invalid SearXNG endpoint");
  }
  const loopback =
    url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ToolRejectionError(
      "INVALID_INPUT",
      "SearXNG endpoint requires HTTPS (or HTTP loopback), without credentials, query or fragment",
    );
  }
  return url.href;
}

function interrupted(signal: AbortSignal): ToolRejectionError {
  if (signal.reason === HOST_CLOSED) return unavailable("web_search host is closed");
  if (signal.reason === TIMED_OUT)
    return new ToolRejectionError("TOOL_TIMEOUT", "web_search request timed out");
  return new ToolRejectionError("CANCELLED", "web_search was cancelled");
}

/** Also releases the abort listener when the underlying permission promise never settles. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(interrupted(signal));
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw unavailable("web_search response has no body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
      throw unavailable("web_search response exceeds the size limit");
    }
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES)
        throw unavailable("web_search response exceeds the size limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    // Cancel unread bytes on oversize/abort; do not let cleanup mask the primary error.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function plainText(value: string, max: number): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalize(body: unknown, input: SearchInput): WebSearchResult {
  const parsed = providerResponse.safeParse(body);
  if (!parsed.success) throw unavailable("web_search response does not match the SearXNG format");
  const results: WebSearchResult["results"] = [];
  const seen = new Set<string>();
  for (const item of parsed.data.results) {
    let url: URL;
    try {
      url = new URL(item.url);
    } catch {
      continue;
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password)
      continue;
    url.hash = "";
    const title = plainText(item.title, 300);
    if (!title || seen.has(url.href)) continue;
    seen.add(url.href);
    results.push({ title, url: url.href, snippet: plainText(item.content ?? "", 2_000) });
    if (results.length === input.maxResults) break;
  }
  return {
    provider: "searxng",
    query: input.query,
    results,
    warnings: parsed.data.unresponsive_engines?.length
      ? ["Some search engines were unavailable; results may be incomplete."]
      : [],
  };
}

/** One Host-owned service; every outbound request requires a trusted D08-compatible handle. */
export class WebSearchService {
  private readonly endpoint: string | undefined;
  private readonly timeoutMs: number;
  private readonly lifetime = new AbortController();

  constructor(options: WebSearchOptions = {}) {
    this.endpoint = options.endpoint === undefined ? undefined : parseEndpoint(options.endpoint);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) {
      throw new ToolRejectionError(
        "INVALID_INPUT",
        "web_search timeout must be between 1 and 60000 ms",
      );
    }
  }

  async search(input: SearchInput, context: ToolContext): Promise<WebSearchResult> {
    const signal = AbortSignal.any([
      this.lifetime.signal,
      ...(context.signal !== undefined ? [context.signal] : []),
    ]);
    if (signal.aborted) throw interrupted(signal);
    if (this.endpoint === undefined) throw unavailable("SearXNG endpoint is not configured");
    if (context.networkPermissions === undefined) {
      throw new ToolRejectionError(
        "UNAUTHORIZED_PATH",
        "web_search requires a trusted network permission handle",
      );
    }
    // Exact destination and arguments go to D08 before any DNS/HTTP work.
    try {
      await abortable(
        context.networkPermissions.authorize({
          kind: "network.request",
          callId: randomUUID(),
          toolName: "web_search",
          url: this.endpoint,
          arguments: {
            method: "POST",
            query: input.query,
            maxResults: input.maxResults,
            format: "json",
            categories: "general",
            safesearch: 1,
          },
        }),
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw interrupted(signal);
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      const permissionCodes: GatewayRejectionCode[] = [
        "INVALID_INPUT",
        "UNAUTHORIZED_PATH",
        "APPROVAL_REQUIRED",
        "APPROVAL_EXPIRED",
        "CANCELLED",
        "RUNTIME_UNAVAILABLE",
      ];
      if (typeof code === "string" && permissionCodes.includes(code as GatewayRejectionCode)) {
        throw new ToolRejectionError(
          code as GatewayRejectionCode,
          "web_search network authorization failed",
        );
      }
      throw unavailable("web_search network authorization failed");
    }
    if (signal.aborted) throw interrupted(signal);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(TIMED_OUT), this.timeoutMs);
    timer.unref();
    const httpSignal = AbortSignal.any([signal, timeout.signal]);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        redirect: "error",
        signal: httpSignal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          q: input.query,
          format: "json",
          categories: "general",
          safesearch: "1",
        }).toString(),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 429)
          throw new ToolRejectionError("RATE_LIMITED", "web_search provider rate limit reached");
        throw unavailable(
          response.status === 403
            ? "SearXNG denied the request; JSON output may be disabled"
            : "web_search provider returned an HTTP error",
        );
      }
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        await response.body?.cancel().catch(() => undefined);
        throw unavailable("SearXNG did not return JSON");
      }
      const text = await readBoundedBody(response, httpSignal);
      return normalize(JSON.parse(text) as unknown, input);
    } catch (error) {
      if (httpSignal.aborted) throw interrupted(httpSignal);
      if (error instanceof ToolRejectionError) throw error;
      // Never forward network/JSON errors: they can embed endpoints, queries or response text.
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    this.lifetime.abort(HOST_CLOSED);
  }
}

export function bindWebSearchTool(
  search: WebSearchService,
): ToolCapability<typeof WebSearchInputSchema> {
  return {
    name: "web_search",
    description:
      "Search the web through the configured SearXNG service. Returns untrusted titles, URLs and snippets, not page contents. Requires network permission; search text is sent to that service.",
    inputSchema: WebSearchInputSchema,
    handler: (params, context) => search.search(params, context),
  };
}
