import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ToolRejectionError,
  type GatewayRejectionCode,
  type ToolCaller,
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

/** Official DeepSeek Search API. Used when no SearXNG address is configured. */
export const DEEPSEEK_SEARCH_URL = "https://api.deepseek.com/v1/tools/search";
const DEEPSEEK_QUERY_LIMIT = 128;

export interface WebSearchOptions {
  /** Full SearXNG /search (or /) endpoint. No implicit public SearXNG service. */
  readonly endpoint?: string;
  /** HTTP timeout, including body consumption; default 15 seconds. */
  readonly timeoutMs?: number;
  /** Test override for the DeepSeek Search URL. Production uses the official endpoint. */
  readonly deepseekUrl?: string;
}

export interface WebSearchResult {
  readonly provider: "searxng" | "deepseek";
  readonly query: string;
  readonly results: Array<{ title: string; url: string; snippet: string }>;
  readonly warnings: string[];
}

const providerResponse = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string(), content: z.string().nullish() })),
  unresponsive_engines: z.array(z.unknown()).optional(),
});
const deepseekResponse = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string().nullish(),
      summary: z.string().nullish(),
    }),
  ),
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

function collectResults(
  items: Array<{ title: string; url: string; text: string }>,
  input: SearchInput,
): WebSearchResult["results"] {
  const results: WebSearchResult["results"] = [];
  const seen = new Set<string>();
  for (const item of items) {
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
    results.push({ title, url: url.href, snippet: plainText(item.text, 2_000) });
    if (results.length === input.maxResults) break;
  }
  return results;
}

function normalize(body: unknown, input: SearchInput): WebSearchResult {
  const parsed = providerResponse.safeParse(body);
  if (!parsed.success) throw unavailable("web_search response does not match the SearXNG format");
  return {
    provider: "searxng",
    query: input.query,
    results: collectResults(
      parsed.data.results.map((item) => ({ title: item.title, url: item.url, text: item.content ?? "" })),
      input,
    ),
    warnings: parsed.data.unresponsive_engines?.length
      ? ["Some search engines were unavailable; results may be incomplete."]
      : [],
  };
}

function normalizeDeepseek(body: unknown, input: SearchInput, warnings: string[]): WebSearchResult {
  const parsed = deepseekResponse.safeParse(body);
  if (!parsed.success) throw unavailable("web_search response does not match the DeepSeek format");
  return {
    provider: "deepseek",
    query: input.query,
    results: collectResults(
      parsed.data.results.map((item) => ({
        title: item.title,
        url: item.url,
        text: item.snippet ?? item.summary ?? "",
      })),
      input,
    ),
    warnings,
  };
}

/** One Host-owned service; every outbound request requires a trusted D08-compatible handle. */
export class WebSearchService {
  private endpoint: string | undefined;
  private resolveApiKey: (() => Promise<string>) | undefined;
  private onResult: ((caller: ToolCaller, result: WebSearchResult) => void) | undefined;
  private readonly deepseekUrl: string;
  private readonly timeoutMs: number;
  private readonly lifetime = new AbortController();

  constructor(options: WebSearchOptions = {}) {
    this.endpoint = options.endpoint === undefined ? undefined : parseEndpoint(options.endpoint);
    this.deepseekUrl = parseEndpoint(options.deepseekUrl ?? DEEPSEEK_SEARCH_URL);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) {
      throw new ToolRejectionError(
        "INVALID_INPUT",
        "web_search timeout must be between 1 and 60000 ms",
      );
    }
  }

  /** Trusted Host configuration. `undefined` clears the endpoint. */
  setEndpoint(value: string | undefined): void {
    this.endpoint = value === undefined ? undefined : parseEndpoint(value);
  }

  currentEndpoint(): string | undefined {
    return this.endpoint;
  }

  /** Same key the chat already saved. The key never enters tool arguments or errors. */
  setApiKeyResolver(resolver: () => Promise<string>): void {
    this.resolveApiKey = resolver;
  }

  /** Called only after a successful normalize. The host must not throw. */
  observe(handler: (caller: ToolCaller, result: WebSearchResult) => void): void {
    this.onResult = handler;
  }

  async search(input: SearchInput, context: ToolContext): Promise<WebSearchResult> {
    const signal = AbortSignal.any([
      this.lifetime.signal,
      ...(context.signal !== undefined ? [context.signal] : []),
    ]);
    if (signal.aborted) throw interrupted(signal);
    const searxUrl = this.endpoint;
    const usingSearx = searxUrl !== undefined;
    const resolveApiKey = this.resolveApiKey;
    if (!usingSearx && resolveApiKey === undefined) throw unavailable("API key is not configured");
    if (context.networkPermissions === undefined) {
      throw new ToolRejectionError(
        "UNAUTHORIZED_PATH",
        "web_search requires a trusted network permission handle",
      );
    }
    let apiKey = "";
    let sentQuery = input.query;
    const extraWarnings: string[] = [];
    if (!usingSearx && resolveApiKey !== undefined) {
      try {
        apiKey = (await abortable(resolveApiKey(), signal)).trim();
      } catch (error) {
        if (signal.aborted) throw interrupted(signal);
        if (error instanceof ToolRejectionError) throw error;
        throw unavailable("API key is not configured");
      }
      if (apiKey.length === 0) throw unavailable("API key is not configured");
      const chars = [...input.query];
      if (chars.length > DEEPSEEK_QUERY_LIMIT) {
        sentQuery = chars.slice(0, DEEPSEEK_QUERY_LIMIT).join("");
        extraWarnings.push("The query was shortened to 128 characters.");
      }
    }
    const url = searxUrl ?? this.deepseekUrl;
    // Exact destination and arguments go to D08 before any DNS/HTTP work.
    try {
      await abortable(
        context.networkPermissions.authorize({
          kind: "network.request",
          callId: randomUUID(),
          toolName: "web_search",
          url,
          arguments: usingSearx
            ? {
                method: "POST",
                query: input.query,
                maxResults: input.maxResults,
                format: "json",
                categories: "general",
                safesearch: 1,
              }
            : {
                method: "POST",
                query: input.query,
                maxResults: input.maxResults,
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
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: httpSignal,
        headers: usingSearx
          ? {
              Accept: "application/json",
              "Content-Type": "application/x-www-form-urlencoded",
            }
          : {
              Accept: "application/json",
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
        body: usingSearx
          ? new URLSearchParams({
              q: input.query,
              format: "json",
              categories: "general",
              safesearch: "1",
            }).toString()
          : JSON.stringify({ query: sentQuery, count: input.maxResults }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 429)
          throw new ToolRejectionError("RATE_LIMITED", "web_search provider rate limit reached");
        if (!usingSearx && response.status === 401) throw unavailable("API key was rejected");
        if (!usingSearx && response.status === 402)
          throw unavailable("the DeepSeek account has no balance for search");
        throw unavailable(
          usingSearx && response.status === 403
            ? "SearXNG denied the request; JSON output may be disabled"
            : "web_search provider returned an HTTP error",
        );
      }
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        await response.body?.cancel().catch(() => undefined);
        throw unavailable(usingSearx ? "SearXNG did not return JSON" : "web_search did not return JSON");
      }
      const text = await readBoundedBody(response, httpSignal);
      const result = usingSearx
        ? normalize(JSON.parse(text) as unknown, input)
        : normalizeDeepseek(JSON.parse(text) as unknown, input, extraWarnings);
      this.onResult?.(context.caller, result);
      return result;
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
      "Search the web. Returns untrusted titles, URLs and snippets, not page contents. Requires network permission. With no separate search address, the query is sent to DeepSeek using the saved API key. A configured SearXNG address is used instead.",
    inputSchema: WebSearchInputSchema,
    handler: (params, context) => search.search(params, context),
  };
}
