/**
 * Status rows and cards are timeline entries. Each one keeps the slot it
 * had when it appeared: later messages render after that slot, so a new
 * bubble cannot push the row to the end of the chat.
 *
 * Orders are small integers (CSS `order` is a 32-bit integer, and message
 * times are millisecond timestamps). Even slots are messages. Odd slots,
 * and -1, are pins that fall between them.
 */
import { createContext, createElement, useContext, type ReactElement, type ReactNode } from "react";

const TimelineTimesContext = createContext<readonly number[]>([]);

export function TimelineOrderProvider(props: {
  times: readonly number[];
  children: ReactNode;
}): ReactElement {
  return createElement(TimelineTimesContext.Provider, { value: props.times }, props.children);
}

export function useTimelineTimes(): readonly number[] {
  return useContext(TimelineTimesContext);
}

/** Messages keep array order. A pin with `at` equal to a message follows that message. */
export function pinSlotOrder(messageTimes: readonly number[], at: number): number {
  if (!Number.isFinite(at)) return -1;
  let before = 0;
  for (const time of messageTimes) {
    if (time <= at) before += 1;
  }
  if (before === 0) return -1;
  return (before - 1) * 2 + 1;
}

export function messageSlotOrder(index: number): number {
  return index * 2;
}

/** The live turn (thinking, tools, failure) stays after every pinned row. */
export function streamSlotOrder(messageCount: number): number {
  if (messageCount <= 0) return 0;
  return (messageCount - 1) * 2 + 2;
}
