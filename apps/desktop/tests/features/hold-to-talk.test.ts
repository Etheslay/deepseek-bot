import { describe, expect, it } from "vitest";
import {
  HOLD_IDLE,
  appendTranscript,
  reduceHold,
  type HoldState,
} from "../../src/renderer/src/features/voice/hold-to-talk.js";

function run(
  events: Parameters<typeof reduceHold>[1][],
  start: HoldState = HOLD_IDLE,
): HoldState {
  return events.reduce((state, event) => reduceHold(state, event).state, start);
}

describe("reduceHold", () => {
  it("starts capture on press and transcribes on release", () => {
    const pressed = reduceHold(HOLD_IDLE, "press");
    expect(pressed).toEqual({ state: { phase: "arming", held: true }, effect: "start" });
    const ready = reduceHold(pressed.state, "capture-ready");
    expect(ready).toEqual({ state: { phase: "recording", held: true }, effect: "none" });
    const released = reduceHold(ready.state, "release");
    expect(released).toEqual({
      state: { phase: "transcribing", held: false },
      effect: "stop",
    });
    expect(reduceHold(released.state, "transcribe-done").state).toEqual(HOLD_IDLE);
  });

  it("cancels when the hold ends before capture is ready", () => {
    const pressed = reduceHold(HOLD_IDLE, "press");
    const released = reduceHold(pressed.state, "release");
    expect(released).toEqual({ state: HOLD_IDLE, effect: "cancel" });
    expect(reduceHold(released.state, "capture-ready").effect).toBe("none");
  });

  it("cancels a capture that arrives after the hold was already dropped", () => {
    const armed = reduceHold(HOLD_IDLE, "press").state;
    const dropped = { ...armed, held: false };
    expect(reduceHold(dropped, "capture-ready")).toEqual({
      state: HOLD_IDLE,
      effect: "cancel",
    });
  });

  it("stops at the contract cap and ignores the later release", () => {
    const recording = run(["press", "capture-ready"]);
    const capped = reduceHold(recording, "cap");
    expect(capped).toEqual({
      state: { phase: "transcribing", held: true },
      effect: "stop",
    });
    expect(reduceHold(capped.state, "release")).toEqual({
      state: { phase: "transcribing", held: false },
      effect: "none",
    });
  });

  it("does not start another clip while the pointer is still down after the cap", () => {
    const afterCap = run(["press", "capture-ready", "cap", "transcribe-done"]);
    expect(afterCap).toEqual({ phase: "idle", held: true });
    expect(reduceHold(afterCap, "press").effect).toBe("none");
    expect(reduceHold(afterCap, "release").state).toEqual(HOLD_IDLE);
  });

  it("ignores a press while transcribing or already recording", () => {
    const recording = run(["press", "capture-ready"]);
    expect(reduceHold(recording, "press").effect).toBe("none");
    const transcribing = reduceHold(recording, "release").state;
    expect(reduceHold(transcribing, "press").effect).toBe("none");
  });

  it("returns to idle when capture fails and does not transcribe", () => {
    const armed = reduceHold(HOLD_IDLE, "press").state;
    expect(reduceHold(armed, "capture-failed")).toEqual({
      state: HOLD_IDLE,
      effect: "none",
    });
  });

  it("ignores a cap or a release when nothing is recording", () => {
    expect(reduceHold(HOLD_IDLE, "cap").effect).toBe("none");
    expect(reduceHold(HOLD_IDLE, "release")).toEqual({ state: HOLD_IDLE, effect: "none" });
  });
});

describe("appendTranscript", () => {
  it("fills an empty draft with the whole transcript", () => {
    expect(appendTranscript("", "你好。再见。")).toBe("你好。再见。");
  });

  it("appends one clip after existing text without splitting sentences", () => {
    expect(appendTranscript("已有内容", "第一句。第二句。")).toBe("已有内容 第一句。第二句。");
  });

  it("leaves the draft untouched when the transcript is blank", () => {
    expect(appendTranscript("保持不动", "   ")).toBe("保持不动");
  });
});
