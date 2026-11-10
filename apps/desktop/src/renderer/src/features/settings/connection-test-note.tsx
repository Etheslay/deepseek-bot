/**
 * The "连接成功" line next to Test connection. Success is a confirmation,
 * so it leaves after five seconds. A failure or an unverified result stays
 * until the next test, because that text is the reason the click did not work.
 */
import { useEffect, type JSX } from "react";
import { t } from "../../i18n.js";

export const CONNECTION_SUCCESS_VISIBLE_MS = 5_000;

export type ConnectionTestResult = {
  result: "success" | "failure" | "unverified";
  ok: boolean;
  errorCode?: string;
};

export function ConnectionTestNote(props: {
  result: ConnectionTestResult | null;
  onDismiss: () => void;
}): JSX.Element | null {
  const { result, onDismiss } = props;

  useEffect(() => {
    if (result?.ok !== true || result.result !== "success") {
      return;
    }
    const timer = setTimeout(onDismiss, CONNECTION_SUCCESS_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [result, onDismiss]);

  if (result === null) {
    return null;
  }
  if (result.result === "unverified") {
    return <span className="settings-soon">{t("shell.connectionUnverified")}</span>;
  }
  return (
    <span className={result.ok ? "settings-ok" : "form-error"}>
      {result.ok ? t("shell.connectionSuccess") : result.errorCode}
    </span>
  );
}
