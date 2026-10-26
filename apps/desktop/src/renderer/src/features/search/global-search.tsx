/**
 * Global search overlay (D25): Ctrl+K opens, Esc closes, typing filters the
 * renderer-first index (bots / messages / quick actions), ↑↓ navigate,
 * Enter selects. Keyboard-only operable end to end.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  filterSearch,
  searchKindLabels,
  type SearchItem,
} from "./search-core.js";
import { t } from "../../i18n.js";

export function GlobalSearch(props: {
  open: boolean;
  items: SearchItem[];
  onSelect: (item: SearchItem) => void;
  onClose: () => void;
}): JSX.Element | null {
  const { open, items, onSelect, onClose } = props;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const results = useMemo(() => filterSearch(items, query).slice(0, 30), [items, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
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
        ) : results.length === 0 ? (
          <div className="gs-hint">{t("search.noResults")}</div>
        ) : (
          <ul className="gs-list" ref={listRef} role="listbox" aria-label={t("search.results")}>
            {results.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={"gs-item" + (index === active ? " active" : "")}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(item)}
                >
                  <span className={"gs-kind gs-kind--" + item.kind}>
                    {searchKindLabels()[item.kind]}
                  </span>
                  <span className="gs-title">{item.title}</span>
                  {item.subtitle && <span className="gs-sub">{item.subtitle}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
