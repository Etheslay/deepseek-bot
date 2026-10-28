/** Avatar renderer for the Grok Ball shape set. */
import type { JSX } from "react";
import type { Avatar } from "./avatar-meta.js";
import { GrokBall, type GrokBallVariant } from "./grok-ball.js";
import type { GrokBallState } from "./grok-ball-model.js";

export function Avatar(props: {
  avatar: Avatar;
  size?: number;
  variant?: GrokBallVariant;
  motion?: boolean;
  /**
   * Momentary state override (e.g. "thinking" while a reply is pending); wins
   * over the avatar's stored state. Omit to use the configured behaviour.
   */
  state?: GrokBallState;
  /** Live pointer gaze (-1..1) written by the owner's hover zone; null = glances. */
  gazeSource?: { readonly current: { x: number; y: number } | null } | undefined;
}): JSX.Element {
  const { avatar, size, variant, motion, state, gazeSource } = props;

  switch (avatar.kind) {
    case "mono":
      return (
        <GrokBall
          variant={variant ?? "preview"}
          size={size}
          motion={motion}
          gazeSource={gazeSource}
          shape="circle"
          color="mono"
          state={state ?? "idle"}
        />
      );
    case "grok":
      return (
        <GrokBall
          variant={variant ?? "preview"}
          size={size}
          motion={motion}
          gazeSource={gazeSource}
          shape={avatar.shape}
          color={avatar.color}
          state={state ?? avatar.state ?? "idle"}
        />
      );
  }
}
