/** Avatar renderer for the Grok Ball shape set. */
import type { JSX } from "react";
import type { Avatar } from "./avatar-meta.js";
import { GrokBall, type GrokBallVariant } from "./grok-ball.js";

export function Avatar(props: {
  avatar: Avatar;
  size?: number;
  variant?: GrokBallVariant;
  motion?: boolean;
}): JSX.Element {
  const { avatar, size, variant, motion } = props;

  switch (avatar.kind) {
    case "mono":
      return (
        <GrokBall
          variant={variant ?? "preview"}
          size={size}
          motion={motion}
          shape="circle"
          color="mono"
          state="idle"
        />
      );
    case "grok":
      return (
        <GrokBall
          variant={variant ?? "preview"}
          size={size}
          motion={motion}
          shape={avatar.shape}
          color={avatar.color}
          state={avatar.state ?? "idle"}
        />
      );
  }
}
