/**
 * Composer microphone: hold to record, release to transcribe into the input.
 *
 * `voice.status` still gates the control (disabled, with a reason, until local
 * whisper is available). Releasing fills the draft through `onTranscript` and
 * never sends. A hold that runs into the contract cap stops and transcribes
 * that one clip; nothing here splits sentences or touches the host voice
 * backend, permissions, or device input.
 */
import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { METHOD_CONTRACTS, VOICE_MAX_CLIP_SECONDS, type VoiceStatus } from "@deepseek-bot/contracts";
import { t } from "../../i18n.js";
import { bytesToBase64 } from "../chat/attachments.js";
import { startClipRecorder, type ClipRecorder } from "./clip-recorder.js";
import {
  HOLD_IDLE,
  reduceHold,
  type HoldEffect,
  type HoldEvent,
  type HoldPhase,
  type HoldState,
} from "./hold-to-talk.js";
import { transcribeButton, type VoicePhase } from "./voice-ui.js";
import { clipProblem, encodeWavPcm16 } from "./wav.js";

export type ComposerMicProps = {
  status: VoiceStatus | null;
  /** One trimmed transcript. The caller appends it to the draft and does not send. */
  onTranscript: (text: string) => void;
  onNotify: (message: string) => void;
};

function shownPhase(phase: HoldPhase): VoicePhase {
  if (phase === "arming" || phase === "recording") {
    return "recording";
  }
  if (phase === "transcribing") {
    return "transcribing";
  }
  return "idle";
}

export function ComposerMic({ status, onTranscript, onNotify }: ComposerMicProps): JSX.Element {
  const [hold, setHold] = useState<HoldState>(HOLD_IDLE);
  const [seconds, setSeconds] = useState(0);
  const holdRef = useRef<HoldState>(HOLD_IDLE);
  const recorderRef = useRef<ClipRecorder | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  const generationRef = useRef(0);
  const finishingRef = useRef(false);
  const sourceRef = useRef<"pointer" | "key" | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onNotifyRef = useRef(onNotify);
  onTranscriptRef.current = onTranscript;
  onNotifyRef.current = onNotify;

  const clearTick = (): void => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const commit = (next: HoldState): void => {
    holdRef.current = next;
    setHold(next);
  };

  const dispatch = (event: HoldEvent): HoldEffect => {
    const result = reduceHold(holdRef.current, event);
    commit(result.state);
    return result.effect;
  };

  const finishClip = async (): Promise<void> => {
    if (finishingRef.current) {
      return;
    }
    finishingRef.current = true;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    clearTick();
    secondsRef.current = 0;
    setSeconds(0);
    try {
      if (recorder === null) {
        return;
      }
      let samples: Float32Array;
      try {
        samples = await recorder.stop();
      } catch {
        samples = new Float32Array(0);
      }
      const problem = clipProblem(samples);
      if (problem !== null) {
        onNotifyRef.current(
          problem === "empty"
            ? t("voice.emptyClip")
            : t("voice.tooLong", [String(VOICE_MAX_CLIP_SECONDS)]),
        );
        return;
      }
      const parsed = METHOD_CONTRACTS["voice.transcribe"].response.parse(
        await window.deepseekBot.host.call("voice.transcribe", {
          audioBase64: bytesToBase64(encodeWavPcm16(samples)),
        }),
      );
      const text = parsed.text.trim();
      if (text.length === 0) {
        onNotifyRef.current(t("voice.transcribedEmpty"));
        return;
      }
      onTranscriptRef.current(text);
    } catch {
      onNotifyRef.current(t("voice.transcribeFailed"));
    } finally {
      finishingRef.current = false;
      dispatch("transcribe-done");
    }
  };

  const applyEffect = (effect: HoldEffect): void => {
    if (effect === "start") {
      const generation = ++generationRef.current;
      void startClipRecorder()
        .then((recorder) => {
          if (generation !== generationRef.current) {
            recorder.cancel();
            return;
          }
          const ready = dispatch("capture-ready");
          if (ready === "cancel") {
            recorder.cancel();
            return;
          }
          recorderRef.current = recorder;
          secondsRef.current = 0;
          setSeconds(0);
          tickRef.current = setInterval(() => {
            const next = secondsRef.current + 1;
            secondsRef.current = next;
            setSeconds(next);
            if (next >= VOICE_MAX_CLIP_SECONDS) {
              clearTick();
              const capped = dispatch("cap");
              if (capped === "stop") {
                void finishClip();
              }
            }
          }, 1000);
        })
        .catch(() => {
          if (generation !== generationRef.current) {
            return;
          }
          dispatch("capture-failed");
          onNotifyRef.current(t("voice.micDenied"));
        });
      return;
    }
    if (effect === "cancel") {
      generationRef.current += 1;
      clearTick();
      recorderRef.current?.cancel();
      recorderRef.current = null;
      secondsRef.current = 0;
      setSeconds(0);
      return;
    }
    if (effect === "stop") {
      generationRef.current += 1;
      void finishClip();
    }
  };

  useEffect(
    () => () => {
      generationRef.current += 1;
      clearTick();
      recorderRef.current?.cancel();
      recorderRef.current = null;
    },
    [],
  );

  const beginFrom = (source: "pointer" | "key"): void => {
    if (holdRef.current.phase !== "idle" || holdRef.current.held) {
      return;
    }
    if (transcribeButton(status, "idle").disabled) {
      return;
    }
    sourceRef.current = source;
    applyEffect(dispatch("press"));
  };

  const endFrom = (source: "pointer" | "key"): void => {
    if (sourceRef.current !== source) {
      return;
    }
    sourceRef.current = null;
    applyEffect(dispatch("release"));
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === "function") {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Capture is missing in some test DOM implementations.
      }
    }
    beginFrom("pointer");
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) {
      return;
    }
    endFrom("pointer");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    beginFrom("key");
  };

  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    endFrom("key");
  };

  const phase = shownPhase(hold.phase);
  const mic = transcribeButton(status, phase);
  const recording = phase === "recording";
  const title =
    mic.reasonKey !== null && !hold.held
      ? t(mic.reasonKey)
      : recording
        ? t("voice.recording", [String(seconds)])
        : phase === "transcribing"
          ? t("voice.transcribing")
          : t("voice.record");

  return (
    <button
      type="button"
      className={"composer-mic" + (recording ? " recording" : "")}
      title={title}
      aria-label={title}
      aria-pressed={recording}
      disabled={mic.disabled && !hold.held}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => endFrom("pointer")}
      onLostPointerCapture={() => endFrom("pointer")}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => {
        if (sourceRef.current === null) {
          return;
        }
        sourceRef.current = null;
        applyEffect(dispatch("release"));
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {recording ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M5 11a7 7 0 0 0 14 0M12 18v3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
