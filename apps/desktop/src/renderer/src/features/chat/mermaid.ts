/**
 * Local mermaid rendering for chat code fences (D14 follow-up).
 *
 * Everything ships in the bundle: the `mermaid` package is dynamically
 * imported (its own async chunk, off the first-screen bundle) and diagrams
 * render offline — no CDN, no remote renderer, ever. Defense in depth for
 * untrusted diagram sources:
 *
 * 1. mermaid runs with `securityLevel: "strict"` — labels are escaped text,
 *    no HTML labels, no event bindings;
 * 2. the produced SVG is sanitized again through DOMPurify (svg profile);
 * 3. the caller mounts the SVG inside a shadow root, so the diagram's inline
 *    `<style>` cannot leak into the page (scripts never execute through
 *    innerHTML and are stripped by the sanitizer anyway).
 */
import DOMPurify from "dompurify";

type MermaidModule = (typeof import("mermaid"))["default"];

let currentTheme: "dark" | "light" = "dark";
let modulePromise: Promise<MermaidModule> | null = null;
/** Theme the loaded module was last initialized with; mermaid.render reads the
 * global config, so a theme switch must re-initialize before the next render. */
let initializedTheme: "dark" | "light" | null = null;
let renderSeq = 0;
/** Rendered-diagram cache keyed `theme\0source`: React may reset a message's
 * innerHTML on any commit, and re-enhancement must not re-run mermaid. */
const svgCache = new Map<string, Promise<string | null>>();
const SVG_CACHE_LIMIT = 50;

/** Theme for diagrams rendered afterwards; already-mounted ones keep theirs. */
export function setMermaidTheme(theme: "dark" | "light"): void {
  currentTheme = theme;
}

async function loadMermaid(): Promise<MermaidModule> {
  modulePromise ??= (async () => (await import("mermaid")).default)();
  const mermaid = await modulePromise;
  if (initializedTheme !== currentTheme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: currentTheme === "dark" ? "dark" : "default",
    });
    initializedTheme = currentTheme;
  }
  return mermaid;
}

function cachedRender(key: string, source: string): Promise<string | null> {
  const hit = svgCache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const pending = (async () => {
    try {
      const mermaid = await loadMermaid();
      renderSeq += 1;
      const { svg } = await mermaid.render(`dsb-mermaid-${renderSeq}`, source);
      const clean = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        // mermaid colors diagrams through an inline <style>; it stays only
        // because the caller mounts the SVG inside a shadow root, where the
        // stylesheet is tree-scoped and cannot reach the page.
        ADD_TAGS: ["style"],
        ADD_ATTR: ["aria-roledescription"],
      });
      return clean.length > 0 ? clean : null;
    } catch {
      return null;
    }
  })();
  svgCache.set(key, pending);
  if (svgCache.size > SVG_CACHE_LIMIT) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) {
      svgCache.delete(oldest);
    }
  }
  return pending;
}

/**
 * Render one diagram source to a sanitized SVG string (cached per theme +
 * source). Returns null on any failure (syntax error, unsupported diagram) so
 * the caller can fall back to showing the source as a plain code block.
 */
export function renderMermaidSvg(source: string): Promise<string | null> {
  return cachedRender(`${currentTheme}\u0000${source}`, source);
}
