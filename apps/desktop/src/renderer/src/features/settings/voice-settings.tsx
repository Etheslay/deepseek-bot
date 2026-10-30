/**
 * Voice settings panel (D27 settings slice).
 *
 * The local whisper configuration lives in the Host settings KV and only the
 * two existing contract methods are used: `voice.config.get/set` plus
 * `voice.status`. File paths are picked through the desktop shell's
 * `voice.pickFile` dialog — the renderer can never hand a path in, it only
 * receives the picked one. A save that leaves transcription unusable (the
 * Host stats existence on `voice.status`) is rolled back to the previous
 * configuration and explained inline: an unusable path is never silently
 * persisted. On success the caller is notified so the composer re-asks
 * `voice.status` and unlocks the microphone without a remount.
 *
 * Without the preload bridge (plain browser preview) the panel degrades to a
 * disabled explanation, never a fake success.
 */
import { useEffect, useRef, useState, type JSX } from "react";
import { METHOD_CONTRACTS, type VoiceConfig, type VoiceStatus } from "@deepseek-bot/contracts";
import { t, type MessageKey } from "../../i18n.js";
import {
  TRANSCRIBE_PROBLEM_KEYS,
  transcribeProblem,
  transcribeProblemField,
} from "../voice/voice-ui.js";
import type { VoicePickKind } from "../../../../shared/voice-pick.js";

/**
 * The stable bridge reference (the window object's own property, like the
 * Chrome panel uses) — a fresh wrapper per render would re-run the load
 * effect forever.
 */
function bridge(): Window["deepseekBot"] | null {
  if (typeof window === "undefined") {
    return null;
  }
  const api = window.deepseekBot;
  if (!api || !("voice" in api) || !("host" in api)) {
    return null;
  }
  return api;
}

function parseConfig(response: unknown): VoiceConfig {
  return METHOD_CONTRACTS["voice.config.get"].response.parse(response);
}

function parseStatus(response: unknown): VoiceStatus {
  return METHOD_CONTRACTS["voice.status"].response.parse(response);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function VoiceSettingsPanel(props: {
  /** The configuration changed and settled; the composer re-asks voice.status. */
  onConfigSaved: () => void;
  onToast: (message: string) => void;
}): JSX.Element {
  const api = bridge();
  const [binDraft, setBinDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [errors, setErrors] = useState<{ bin: MessageKey | null; model: MessageKey | null }>({
    bin: null,
    model: null,
  });
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<"save" | "pick" | null>(null);
  /** The configuration the Host had before the current save attempt. */
  const previousRef = useRef<VoiceConfig>({ whisperBin: null, whisperModel: null });

  useEffect(() => {
    if (api === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const config = parseConfig(await api.host.call("voice.config.get", {}));
        if (cancelled) return;
        previousRef.current = config;
        setBinDraft(config.whisperBin ?? "");
        setModelDraft(config.whisperModel ?? "");
      } catch {
        // Bridge present but the Host is not answering yet: keep the drafts.
      }
    })();
    void (async () => {
      try {
        const next = parseStatus(await api.host.call("voice.status", {}));
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (api === null) {
    return (
      <div className="settings-row">
        <span>{t("voice.settingsWhisperBin")}</span>
        <span className="settings-soon">{t("voice.transcribeUnavailable")}</span>
      </div>
    );
  }

  const pick = async (kind: VoicePickKind): Promise<void> => {
    setBusy("pick");
    try {
      const picked = await api.voice.pickFile(kind);
      if (!picked.ok) {
        return;
      }
      if (kind === "bin") {
        setBinDraft(picked.path);
        setErrors((prev) => ({ ...prev, bin: null }));
      } else {
        setModelDraft(picked.path);
        setErrors((prev) => ({ ...prev, model: null }));
      }
    } catch (error) {
      props.onToast(t("voice.settingsSaveFailed", [errorMessage(error)]));
    } finally {
      setBusy(null);
    }
  };

  const save = async (): Promise<void> => {
    const bin = binDraft.trim();
    const model = modelDraft.trim();
    const required: { bin: MessageKey | null; model: MessageKey | null } = {
      bin: bin.length === 0 ? "voice.settingsBinRequired" : null,
      model: model.length === 0 ? "voice.settingsModelRequired" : null,
    };
    setErrors(required);
    if (bin.length === 0 || model.length === 0) {
      return;
    }
    setBusy("save");
    const next: VoiceConfig = { whisperBin: bin, whisperModel: model };
    try {
      parseConfig(await api.host.call("voice.config.set", next));
      let nextStatus: VoiceStatus | null = null;
      try {
        nextStatus = parseStatus(await api.host.call("voice.status", {}));
      } catch {
        nextStatus = null;
      }
      if (nextStatus === null) {
        // The status check itself failed: keep the saved configuration and let
        // the composer's own refresh report what the Host sees.
        setStatus(null);
        props.onConfigSaved();
        return;
      }
      const problem = transcribeProblem(nextStatus);
      if (problem === null) {
        previousRef.current = next;
        setErrors({ bin: null, model: null });
        setStatus(nextStatus);
        props.onConfigSaved();
        props.onToast(t("voice.settingsSaved"));
        return;
      }
      // Unusable paths never persist: restore what the Host had before and
      // explain inline which file the status check rejected.
      await api.host.call("voice.config.set", previousRef.current);
      const field = transcribeProblemField(problem);
      setErrors({
        bin: field === "bin" ? TRANSCRIBE_PROBLEM_KEYS[problem] : null,
        model: field === "model" ? TRANSCRIBE_PROBLEM_KEYS[problem] : null,
      });
      try {
        setStatus(parseStatus(await api.host.call("voice.status", {})));
      } catch {
        setStatus(null);
      }
      props.onConfigSaved();
    } catch (error) {
      props.onToast(t("voice.settingsSaveFailed", [errorMessage(error)]));
    } finally {
      setBusy(null);
    }
  };

  const statusText = checking
    ? t("voice.checking")
    : status === null
      ? t("voice.settingsUnavailable")
      : (() => {
          const problem = transcribeProblem(status);
          return problem === null ? t("voice.settingsReady") : t(TRANSCRIBE_PROBLEM_KEYS[problem]);
        })();

  return (
    <div className="voice-settings" data-testid="voice-settings">
      <p className="settings-hint">{t("voice.settingsIntro")}</p>
      <div className="settings-row">
        <span>
          {t("voice.settingsWhisperBin")}
          {errors.bin !== null && <em className="field-error">{t(errors.bin)}</em>}
        </span>
        <span className="key-input-wrap voice-fields">
          <input
            className="settings-select key-input"
            value={binDraft}
            placeholder={t("shell.notConfigured")}
            aria-label={t("voice.settingsWhisperBin")}
            onChange={(e) => setBinDraft(e.target.value)}
          />
          <button
            type="button"
            className="pill-btn"
            disabled={busy !== null}
            aria-label={t("voice.settingsPickBin")}
            onClick={() => void pick("bin")}
          >
            {t("voice.settingsPick")}
          </button>
        </span>
      </div>
      <div className="settings-row">
        <span>
          {t("voice.settingsWhisperModel")}
          {errors.model !== null && <em className="field-error">{t(errors.model)}</em>}
        </span>
        <span className="key-input-wrap voice-fields">
          <input
            className="settings-select key-input"
            value={modelDraft}
            placeholder={t("shell.notConfigured")}
            aria-label={t("voice.settingsWhisperModel")}
            onChange={(e) => setModelDraft(e.target.value)}
          />
          <button
            type="button"
            className="pill-btn"
            disabled={busy !== null}
            aria-label={t("voice.settingsPickModel")}
            onClick={() => void pick("model")}
          >
            {t("voice.settingsPick")}
          </button>
        </span>
      </div>
      <div className="settings-row">
        <span>{t("voice.settingsStatus")}</span>
        <span className="key-input-wrap">
          <span className="settings-soon">{statusText}</span>
          <button type="button" className="pill-btn" disabled={busy !== null} onClick={() => void save()}>
            {t("shell.save")}
          </button>
        </span>
      </div>
    </div>
  );
}
