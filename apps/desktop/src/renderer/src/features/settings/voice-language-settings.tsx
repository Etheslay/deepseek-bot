/**
 * Voice settings: transcription language only.
 *
 * Hold-to-talk passes this choice to whisper-cli as `-l zh` or `-l en`.
 * The shipped whisper.cpp build stays in place; this panel does not ask for
 * a binary path or a model path.
 */
import type { JSX } from "react";
import type { VoiceTranscriptionLanguage } from "@deepseek-bot/contracts";
import { CustomSelect } from "../../components/custom-select.js";
import { t, useLanguage } from "../../i18n.js";

export function VoiceLanguageSettings(props: {
  value: VoiceTranscriptionLanguage;
  onChange: (language: VoiceTranscriptionLanguage) => void;
}): JSX.Element {
  useLanguage();
  return (
    <div className="settings-card">
      <div className="settings-row">
        <span>{t("voice.transcribeLanguage")}</span>
        <CustomSelect
          value={props.value}
          options={[
            { value: "zh", label: t("voice.languageZh") },
            { value: "en", label: t("voice.languageEn") },
          ]}
          onChange={(value) => props.onChange(value === "en" ? "en" : "zh")}
          ariaLabel={t("voice.transcribeLanguage")}
        />
      </div>
      <p className="session-meta">{t("voice.transcribeLanguageHint")}</p>
    </div>
  );
}
