/**
 * Messages returned by openSession for the bot's stored chat.
 * A null list is still loading. An empty list has nothing to show.
 */
import type { JSX } from "react";
import type { ChatHistoryRow } from "../../services/desktop-service.js";
import { t } from "../../i18n.js";

export function StoredSessionReplay(props: {
  messages: readonly ChatHistoryRow[] | null;
}): JSX.Element | null {
  if (props.messages === null) return null;
  if (props.messages.length === 0) {
    return <div className="sys-line">{t("shell.noReplayMessages")}</div>;
  }
  return (
    <>
      {props.messages.map((message) => {
        const user = message.role === "user";
        return (
          <div key={message.id} className={"msg-row" + (user ? " user" : " bot")}>
            <div className={"msg-bubble" + (user ? " user" : "")}>{message.text}</div>
          </div>
        );
      })}
    </>
  );
}
