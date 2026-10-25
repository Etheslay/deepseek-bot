/** Avatar renderer for the Grok Ball shape set. */
import type { JSX } from "react";
import type { Avatar } from "./avatar-meta.js";
import { GrokBall } from "./grok-ball.js";

export function Avatar(props: { avatar: Avatar; size: number }): JSX.Element {
  const { avatar, size } = props;

  switch (avatar.kind) {
    case "mono":
      return <GrokBall shape="circle" color="mono" state="idle" size={size} />;
    case "grok":
      return (
        <GrokBall
          shape={avatar.shape}
          color={avatar.color}
          state={avatar.state ?? "idle"}
          size={size}
        />
      );
  }
}
