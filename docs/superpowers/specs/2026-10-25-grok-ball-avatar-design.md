# Grok Ball Avatar Design

## Goal

Replace the current static “ball” avatar with a reusable, animated Grok Ball component for the DeepSeek Bot desktop shell. The component must feel alive: the body breathes, the eyes follow the cursor with damping, the avatar blinks on a spring, and its expression morphs between agent states instead of hard-cutting.

## Scope

- Add a reusable `GrokBall` component under `apps/desktop/src/renderer/src/features/avatars/`.
- Keep the existing avatar picker API stable; the component is consumed by `Avatar` and `AvatarPicker`.
- Support the official/API shape subset: `blob`, `pebble`, `bean`, `egg`, `squircle`, `capsule`, `hex`, `cloud`.
- Support color switching and the existing theme-aware black/white mode.
- Support the state machine: `Idle`, `Thinking`, `Working`, `Waiting`, `Blocked`, `Done`.
- Keep the animation loop local to the component; no global timer or app-wide state changes.

## Non-goals

- No 3D engine, no WebGL, no external avatar assets.
- No change to bot persistence or contract types.
- No copy of official Grok artwork; all visuals are geometric and self-drawn.

## Architecture

### Pure model

`grok-ball-model.ts` owns the testable geometry and state math:

- `GrokBallShapeId`
- `GrokBallState`
- `projectEye(gaze, side)` — 3D eye position projected to 2D with a z-depth used for backface hiding.
- `interpolatePoints(a, b, t)` — pointwise keyframe interpolation.
- `mixColor(a, b, t)` — color interpolation for state transitions.
- `sampleContour(points, resolution)` — contour sampling for silhouette clipping.
- `GROK_BALL_SHAPES` — shape definitions.
- `GROK_BALL_STATE_FRAMES` — per-state eye-ring keyframes.

### React component

`grok-ball.tsx` owns rendering and animation:

- SVG output with a stable `0 0 100 100` viewBox.
- A `<clipPath>` generated from the body contour keeps eyes inside the silhouette.
- `requestAnimationFrame` loop updates:
  - gaze damping (~100 ms),
  - idle saccade,
  - breathing scale (1–2%, 3–4 s),
  - blink spring (2–6 s random interval),
  - state morph (200–350 ms),
  - Thinking orbit,
  - Done burst.
- Mouse tracking is local to the component.
- The component accepts `size`, `shape`, `color`, `state`, and `theme`.

## State behavior

- **Idle:** neutral eyes, slow breathing, occasional saccade.
- **Thinking:** narrowed eyes, slight tilt, orbiting ring.
- **Working:** focused eyes, faster micro-pulse.
- **Waiting:** wide eyes, upward gaze.
- **Blocked:** slanted eyes, red aura.
- **Done:** happy eyes, short expanding burst.

## Testing

- Unit tests cover projection, interpolation, contour sampling, and state keyframes.
- Typecheck, lint, tests, and desktop build must pass.
- The report records the branch, SHA, PR, and verification evidence.

