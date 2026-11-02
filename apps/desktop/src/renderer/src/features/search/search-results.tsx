/**
 * Chat cards for web_search results already stored by the Host.
 * Titles, URLs and snippets are untrusted text. This view does not fetch them.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { pinSlotOrder, useTimelineTimes } from "../chat/timeline.js";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";
import { type Notice, noticeText, t, useLanguage } from "../../i18n.js";

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type SearchRecord = {
  query: string;
  results: SearchResult[];
  warnings: string[];
  at: string;
};

export function SearchResultCards({ botId }: { botId: string }): JSX.Element | null {
  return <BotSearchCards key={botId} botId={botId} />;
}

function linkable(value: string): string | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function BotSearchCards({ botId }: { botId: string }): JSX.Element | null {
  const [searches, setSearches] = useState<SearchRecord[] | null>(null);
  useLanguage();
  const [notice, setNotice] = useState<Notice | null>(null);
  const active = useRef(true);
  const loadSequence = useRef(0);
  const times = useTimelineTimes();
  const noticeAt = useRef<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current;
    const response = await window.deepseekBot.host.call("search.results.list", { botId });
    const parsed = METHOD_CONTRACTS["search.results.list"].response.parse(response);
    if (!active.current || sequence !== loadSequence.current) return;
    setSearches(parsed.searches);
    setNotice((current) => (current?.key === "search.resultsReadFailed" ? null : current));
  }, [botId]);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const run = (): void => {
      void load().catch(() => {
        if (!cancelled) setNotice({ key: "search.resultsReadFailed" });
      });
    };
    run();
    const timer = setInterval(run, 1_000);
    return () => {
      active.current = false;
      cancelled = true;
      clearInterval(timer);
    };
  }, [load]);

  if ((searches === null || searches.length === 0) && notice === null) return null;

  return (
    <div className="search-result-cards">
      {notice !== null ? (
        <div
          role="status"
          style={{
            order: pinSlotOrder(
              times,
              noticeAt.current ?? (noticeAt.current = Date.now()),
            ),
          }}
        >
          {noticeText(notice)}
        </div>
      ) : null}
      {(searches ?? []).map((search) => (
        <section
          key={`${search.at}:${search.query}`}
          style={{ order: pinSlotOrder(times, Date.parse(search.at)) }}
          aria-label={t("search.queryLabel", [search.query])}
        >
          <div>{search.query}</div>
          {search.results.map((item) => {
            const href = linkable(item.url);
            return (
              <div key={`${item.url}:${item.title}`}>
                <div>{item.title}</div>
                {href === null ? (
                  <span>{item.url}</span>
                ) : (
                  <a href={href} rel="noreferrer">
                    {item.url}
                  </a>
                )}
                <div>{item.snippet}</div>
              </div>
            );
          })}
          {search.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </section>
      ))}
    </div>
  );
}
