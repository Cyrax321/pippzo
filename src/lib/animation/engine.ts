// Deterministic animation engine.
// One clock `T` (seconds). Every visual property is a PURE function of T.
// Nothing here may depend on wall-clock time, rAF, or React effects — the
// exporter seeks to an arbitrary T and serialises the DOM immediately after.

export function clamp(v: number, min = 0, max = 1) {
  return v < min ? min : v > max ? max : v;
}

export function interpolate(t: number, inRange: [number, number], outRange: [number, number]) {
  const [i0, i1] = inRange;
  const [o0, o1] = outRange;
  if (i1 === i0) return o1;
  return o0 + ((t - i0) / (i1 - i0)) * (o1 - o0);
}

export type EasingFn = (t: number) => number;

export const Easing: Record<string, EasingFn> = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t) => t * t * t * t,
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

export type EasingName = keyof typeof Easing;

export function easingByName(name?: string): EasingFn {
  return (name && Easing[name]) || Easing.outCubic;
}

export type AnimateSpec = {
  from: number;
  to: number;
  start: number;
  end: number;
  ease?: string;
};

/** Returns a pure function of T for one animated scalar. */
export function animate(spec: AnimateSpec): (T: number) => number {
  const ease = easingByName(spec.ease);
  return (T: number) => {
    const k = clamp(interpolate(T, [spec.start, spec.end], [0, 1]));
    return spec.from + (spec.to - spec.from) * ease(k);
  };
}

/** Sample an animated scalar at T, falling back to a constant. */
export function sample(spec: AnimateSpec | number | undefined, T: number, fallback: number) {
  if (spec === undefined) return fallback;
  if (typeof spec === "number") return spec;
  return animate(spec)(T);
}

/** Small named motion helpers, mirroring the constrained API an LLM authors against. */
export const MOTION = {
  enter: (start: number, end: number, from = 80, to = 0) =>
    animate({ from, to, start, end, ease: "outCubic" }),
  fade: (start: number, end: number) => animate({ from: 0, to: 1, start, end, ease: "outCubic" }),
  draw: (start: number, end: number) => animate({ from: 0, to: 1, start, end, ease: "inOutQuart" }),
  pop: (start: number, end: number) => animate({ from: 0, to: 1, start, end, ease: "outBack" }),
};

export const frameCount = (duration: number, fps: number) =>
  Math.max(1, Math.round(duration * fps));
export const timeForFrame = (frame: number, fps: number) => frame / fps;
