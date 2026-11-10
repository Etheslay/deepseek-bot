// @vitest-environment jsdom
import { createElement, Fragment, type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GrokBall, hopOffset, spinPhase } from "../../src/renderer/src/features/avatars/grok-ball.js";

describe("idle trick physics", () => {
  it("lands a decaying bounce and then stops", () => {
    expect(hopOffset(0)).toBe(0);
    // Collect the local minima: each is one hop's apex.
    const apexes: number[] = [];
    let previous = hopOffset(0)!;
    for (let ms = 1; ms < 4000; ms++) {
      const value = hopOffset(ms);
      if (value === null) {
        expect(ms).toBeLessThan(2500); // it must come back to rest
        break;
      }
      const next = hopOffset(ms + 1);
      if (next !== null && value < previous && value <= next && value < -1) {
        apexes.push(value);
      }
      previous = value;
    }
    expect(apexes.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < apexes.length; i++) {
      expect(Math.abs(apexes[i]!)).toBeLessThan(Math.abs(apexes[i - 1]!));
    }
  });

  it("turns once, from rest to rest", () => {
    expect(spinPhase(-1)).toBeNull();
    expect(spinPhase(0)).toBe(0);
    expect(spinPhase(10_000)).toBeNull();
    let previous = -1;
    for (const t of [0, 100, 200, 300, 400, 500, 600, 700, 759]) {
      const phase = spinPhase(t)!;
      expect(phase).toBeGreaterThan(previous);
      previous = phase;
    }
    expect(previous).toBeLessThan(1);
    expect(spinPhase(380)).toBeCloseTo(0.5, 1);
  });
});

/** Every coordinate in a path's `d`, as viewBox points. */
function pathPoints(d: string): Array<[number, number]> {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const points: Array<[number, number]> = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push([numbers[i]!, numbers[i + 1]!]);
  }
  return points;
}

/** Body width across a height band — the honest way to tell a △ from a ▽. */
function spanAt(points: Array<[number, number]>, low: number, high: number): number {
  const xs = points.filter(([, y]) => y >= low && y <= high).map(([x]) => x);
  if (xs.length < 2) {
    return -1;
  }
  return Math.max(...xs) - Math.min(...xs);
}

function body(group: Element): { fill: string | null; d: string } {
  const path = Array.from(group.querySelectorAll("path")).find(
    (candidate) => !candidate.closest("clipPath") && candidate.getAttribute("stroke"),
  );
  return { fill: path?.getAttribute("fill") ?? null, d: path?.getAttribute("d") ?? "" };
}

describe("GrokBall solid renderer", () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  function mount(el: ReactElement): void {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(el);
    });
  }

  function shell(): Element {
    return host!.querySelector(".grok-ball")!.querySelectorAll(":scope > g")[0]!;
  }

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
  });

  it("paints the body as one flat pure colour, with no darkened facets", async () => {
    mount(createElement(GrokBall, { variant: "preview", shape: "circle", color: "#2A92FE" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    const group = shell();
    const painted = body(group);
    // A palette colour resolves through the theme-aware tone variable, with the
    // stored hex as the fallback — and it is still exactly ONE flat colour.
    expect(painted.fill, "body colour").toBe("var(--gb-body, #2A92FE)");
    // The old build painted hundreds of quads, each with its own tone: rings
    // on a ball that is meant to be one colour.
    const tones = new Set(
      Array.from(group.querySelectorAll("path"))
        .map((path) => path.getAttribute("fill"))
        .filter((fill) => fill !== null && !fill.startsWith("url(")),
    );
    expect([...tones]).toEqual(["var(--gb-body, #2A92FE)"]);
    // Nothing may paint a second tone over the body.
    expect(group.querySelector("ellipse"), "no gloss overlay").toBeNull();
    expect(group.querySelector("radialGradient"), "no gradient overlay").toBeNull();
    const points = pathPoints(painted.d);
    expect(points.length, "silhouette samples").toBeGreaterThan(40);
    expect(spanAt(points, 45, 55)).toBeGreaterThan(60);
  });

  it("gives every ball its own idle rhythm, so a row never moves in lockstep", async () => {
    const multi = document.createElement("div");
    document.body.append(multi);
    const multiRoot = createRoot(multi);
    act(() => {
      multiRoot.render(
        createElement(
          Fragment,
          null,
          [0, 1, 2, 3, 4].map((i) =>
            createElement(GrokBall, { key: i, variant: "sidebar", shape: "blob", color: "#2A92FE" }),
          ),
        ),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    // Every ball mounts in the same frame. Without a per-instance phase they
    // would all sample the sway sines at the same point and rock together.
    const rotations = Array.from(multi.querySelectorAll(".grok-ball > g")).map((g) => {
      const m = /rotate\(([-\d.]+)\)/.exec(g.getAttribute("transform") ?? "");
      return m ? Number(m[1]) : null;
    });
    expect(rotations.every((r) => r !== null), "all balls animated").toBe(true);
    expect(new Set(rotations).size, `identical rotations: ${rotations.join(",")}`).toBeGreaterThan(1);
    act(() => {
      multiRoot.unmount();
    });
    multi.remove();
  });

  it("hooks a palette colour to the theme, and a stray hex to itself", () => {
    mount(createElement(GrokBall, { variant: "inline", shape: "blob", color: "#2A92FE" }));
    expect(host!.querySelector(".grok-ball")!.getAttribute("data-tone")).toBe("blue");

    act(() => {
      root?.unmount();
    });
    host?.remove();

    // A retired swatch still belongs to its tone, so it picks up the brighter paint.
    mount(createElement(GrokBall, { variant: "inline", shape: "blob", color: "#3b93f0" }));
    expect(host!.querySelector(".grok-ball")!.getAttribute("data-tone")).toBe("blue");
    expect(body(shell()).fill).toBe("var(--gb-body, #3b93f0)");

    act(() => {
      root?.unmount();
    });
    host?.remove();

    // A hand-picked hex has no pair: no tone hook, painted as is.
    mount(createElement(GrokBall, { variant: "inline", shape: "blob", color: "#abcdef" }));
    expect(host!.querySelector(".grok-ball")!.getAttribute("data-tone")).toBeNull();
    expect(body(shell()).fill).toBe("var(--gb-body, #abcdef)");
  });

  it("turns the eyes around the body and repaints the outline on a glance", async () => {
    const gaze = { current: { x: 0, y: 0 } };
    mount(
      createElement(GrokBall, {
        variant: "preview",
        shape: "cylinder",
        color: "#2A92FE",
        gazeSource: gaze,
      }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1400));
    });
    const svg = host!.querySelector(".grok-ball")!;
    const eyeX = (): number =>
      Number(
        /translate\(([-\d.]+)/.exec(
          svg.querySelector(".gb-eye")!.parentElement!.getAttribute("transform") ?? "",
        )?.[1] ?? 0,
      );
    const facing = { eye: eyeX(), body: body(shell()).d };
    await act(async () => {
      gaze.current = { x: 1, y: 0 };
      await new Promise((resolve) => setTimeout(resolve, 1400));
    });
    const turned = { eye: eyeX(), body: body(shell()).d };
    // The eyes ride the solid: a glance must slide them across the surface.
    expect(Math.abs(turned.eye - facing.eye)).toBeGreaterThan(2);
    // And the outline is a projection, not a sticker: its path data changes.
    expect(turned.body).not.toBe(facing.body);
  });

  it("keeps eyes riding the shell and updates their transform", async () => {
    mount(createElement(GrokBall, { variant: "preview", shape: "star5", color: "#3b93f0" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    const svg = host!.querySelector(".grok-ball")!;
    const eye = svg.querySelector(".gb-eye")!.parentElement!.getAttribute("transform") ?? "";
    expect(eye).toContain("scale");
  });

  it("stands the triangle on its base, not on its point", () => {
    mount(createElement(GrokBall, { variant: "inline", shape: "triangle", color: "#f0b429" }));
    const points = pathPoints(body(shell()).d);
    const top = spanAt(points, 18, 32);
    const bottom = spanAt(points, 66, 80);
    expect(top, "upper body width").toBeGreaterThan(0);
    expect(bottom, "lower body width").toBeGreaterThan(0);
    // ▽ (wide crown, pointed chin) was rejected: a body must rest on width.
    expect(top).toBeLessThan(bottom);
  });

  it("keeps every shape's silhouette smooth, not faceted", () => {
    for (const shape of ["blob", "star4", "heart", "pumpkin", "capsule"] as const) {
      mount(createElement(GrokBall, { variant: "preview", shape, color: "#2fbfa0" }));
      const points = pathPoints(body(shell()).d);
      let worst = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        worst = Math.max(worst, Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      expect(worst, `${shape} longest outline segment`).toBeLessThan(9);
      act(() => {
        root?.unmount();
      });
      root = null;
      host = null;
    }
  });
});
