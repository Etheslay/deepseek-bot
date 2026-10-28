/**
 * Global search overlay (D25): Ctrl+K opens, Esc closes, ↑↓ navigate, Enter
 * selects. Two result sources share one keyboard-navigable list: the local
 * renderer index (loaded bots, open-session messages, quick actions) and the
 * D25-second-half Host retrieval (`search.global` via `queryHost`, debounced,
 * stale responses dropped). Host failures degrade honestly to local-only plus
 * a status line.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  dedupeHostItems,
  filterSearch,
  searchKindLabels,
  type SearchItem,
} from "./search-core.js";
import { t } from "../../i18n.js";

const HOST_DEBOUNCE_MS = 250;

type HostPhase = "idle" | "loading" | "done" | "failed";

export function GlobalSearch(props: {
  open: boolean;
  items: SearchItem[];
  onSelect: (item: SearchItem) => void;
  onClose: () => void;
  /** `search.global` bridge; omitted environments (fixtures) stay local-only. */
  queryHost?: (query: string) => Promise<SearchItem[]>;
}): JSX.Element | null {
  const { open, items, onSelect, onClose, queryHost } = props;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [host, setHost] = useState<{ phase: HostPhase; items: SearchItem[] }>({
    phase: "idle",
    items: [],
  });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  /** Monotonic guard: only the newest debounced request may write results. */
  const requestRef = useRef(0);
  // Latest-bridge ref: App passes an inline arrow, so the debounce effect
  // must key on the query alone, not on the callback identity.
  const queryHostRef = useRef(queryHost);
  useEffect(() => {
    queryHostRef.current = queryHost;
  }, [queryHost]);

  const localResults = useMemo(() => filterSearch(items, query).slice(0, 30), [items, query]);
  const hostItems = useMemo(
    () => dedupeHostItems(localResults, host.items),
    [localResults, host.items],
  );
  const results = useMemo(() => [...localResults, ...hostItems], [localResults, hostItems]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestRef.current += 1;
      setHost({ phase: "idle", items: [] });
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // D25 second half: debounce the Host query; an empty query or a missing
  // bridge stays idle. Responses carry the request id they belong to, and a
  // stale resolve is dropped instead of overwriting newer results.
  useEffect(() => {
    const bridgeQuery = queryHostRef.current;
    if (bridgeQuery === undefined) {
      return;
    }
    const trimmed = query.trim();
    if (trimmed === "") {
      requestRef.current += 1;
      setHost({ phase: "idle", items: [] });
      return;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setHost({ phase: "loading", items: [] });
    const timer = setTimeout(() => {
      bridgeQuery(trimmed)
        .then((hits) => {
          if (requestRef.current === requestId) {
            setHost({ phase: "done", items: hits });
          }
        })
        .catch(() => {
          if (requestRef.current === requestId) {
            setHost({ phase: "failed", items: [] });
          }
        });
    }, HOST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const choose = (item: SearchItem): void => {
    onSelect(item);
    onClose();
  };

  // `active` indexes the combined list; host rows need the local length offset.
  const renderRow = (item: SearchItem, index: number, offset: number): JSX.Element => (
    <li key={item.id}>
      <button
        type="button"
        role="option"
        aria-selected={index + offset === active}
        className={"gs-item" + (index + offset === active ? " active" : "")}
        onMouseEnter={() => setActive(index + offset)}
        onClick={() => choose(item)}
      >
        <span className={"gs-kind gs-kind--" + item.kind}>
          {searchKindLabels()[item.kind]}
        </span>
        <span className="gs-title">{item.title}</span>
        {item.subtitle && <span className="gs-sub">{item.subtitle}</span>}
      </button>
    </li>
  );

  const showStatus = host.phase === "loading" || host.phase === "failed";

  return (
    <div className="gs-backdrop" onClick={onClose}>
      <div
        className="gs-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("search.dialog")}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="gs-input"
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((prev) => Math.min(prev + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((prev) => Math.max(prev - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const item = results[active];
              if (item) {
                choose(item);
              }
            }
          }}
        />
        {query.trim() === "" ? (
          <div className="gs-hint">{t("search.emptyHint")}</div>
        ) : results.length === 0 && !showStatus ? (
          <div className="gs-hint">{t("search.noResults")}</div>
        ) : (
          <>
            {showStatus && (
              <div className="gs-status" role="status">
                {host.phase === "loading" ? t("search.searching") : t("search.hostFailed")}
              </div>
            )}
            {localResults.length > 0 && (
              <div className="gs-section">{t("search.localSection")}</div>
            )}
            <ul className="gs-list" ref={listRef} role="listbox" aria-label={t("search.results")}>
              {localResults.map((item, index) => renderRow(item, index, 0))}
            </ul>
            {hostItems.length > 0 && (
              <>
                <div className="gs-section">{t("search.hostSection")}</div>
                <ul className="gs-list" role="listbox" aria-label={t("search.hostSection")}>
                  {hostItems.map((item, index) => renderRow(item, index, localResults.length))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
