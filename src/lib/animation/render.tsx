// Renders a Composition at an exact time T as pure SVG primitives.
// Pure: same T -> same DOM.
//
// IMPORTANT: no <foreignObject>. Chromium taints a canvas as soon as an SVG
// image containing foreignObject is drawn onto it, which makes toDataURL /
// getImageData / new VideoFrame(canvas) throw SecurityError — i.e. HTML-in-SVG
// can be previewed but never exported. Everything below is native SVG so the
// same node rasterises cleanly.
import { Fragment } from "react";
import { sample } from "./engine";
import type { Composition, Frame, Gradient, Layer, Motion } from "./schema";

type Sampled = {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  blur: number;
  reveal: number;
};

function sampleMotion(motion: Motion | undefined, T: number): Sampled {
  const m = motion ?? {};
  return {
    opacity: sample(m.opacity, T, 1),
    x: sample(m.x, T, 0),
    y: sample(m.y, T, 0),
    scale: sample(m.scale, T, 1),
    rotate: sample(m.rotate, T, 0),
    blur: sample(m.blur, T, 0),
    reveal: m.reveal === undefined ? 1 : sample(m.reveal, T, 1),
  };
}

/** Transform about the centre of the layer frame, matching CSS transform-origin: center. */
function transformFor(layer: Layer, s: Sampled) {
  const f: Partial<Frame> = layer.frame ?? {};
  const cx = (f.x ?? 0) + (f.width ?? 0) / 2;
  const cy = (f.y ?? 0) + (f.height ?? 0) / 2;
  return `translate(${s.x} ${s.y}) translate(${cx} ${cy}) rotate(${s.rotate}) scale(${s.scale}) translate(${-cx} ${-cy})`;
}

function gradientDef(id: string, g: Gradient) {
  const stops = g.stops.map((st: Gradient["stops"][number], i: number) => (
    <stop
      key={i}
      offset={`${st.offset * 100}%`}
      stopColor={st.color}
      stopOpacity={st.opacity ?? 1}
    />
  ));
  if (g.type === "radial") {
    return (
      <radialGradient id={id} cx="50%" cy="50%" r="60%">
        {stops}
      </radialGradient>
    );
  }
  const rad = ((g.angle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  return (
    <linearGradient
      id={id}
      x1={`${(0.5 - dx) * 100}%`}
      y1={`${(0.5 - dy) * 100}%`}
      x2={`${(0.5 + dx) * 100}%`}
      y2={`${(0.5 + dy) * 100}%`}
    >
      {stops}
    </linearGradient>
  );
}

/** Naive greedy wrap on an average glyph width — deterministic, no measuring. */
function wrapLines(text: string, fontSize: number, maxWidth?: number): string[] {
  const hard = text.split("\n");
  if (!maxWidth) return hard;
  const perChar = fontSize * 0.54;
  const maxChars = Math.max(4, Math.floor(maxWidth / perChar));
  const out: string[] = [];
  for (const line of hard) {
    let current = "";
    for (const word of line.split(" ")) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        out.push(current);
        current = word;
      } else current = next;
    }
    out.push(current);
  }
  return out;
}

function LayerView({ layer, T }: { layer: Layer; T: number }) {
  const inT = layer.in ?? -Infinity;
  const outT = layer.out ?? Infinity;
  if (T < inT || T >= outT) return null;

  const s = sampleMotion(layer.motion, T);
  if (s.opacity <= 0.001) return null;

  const f: Partial<Frame> = layer.frame ?? {};
  const fx = f.x ?? 0;
  const fy = f.y ?? 0;
  const uid = `l-${layer.id}`;

  const defs: React.ReactNode[] = [];
  let filter: string | undefined;
  let clipPath: string | undefined;

  if (s.blur > 0.01) {
    defs.push(
      <filter key="b" id={`${uid}-blur`} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation={s.blur} />
      </filter>,
    );
    filter = `url(#${uid}-blur)`;
  }
  if (s.reveal < 0.999 && f.width) {
    defs.push(
      <clipPath key="c" id={`${uid}-clip`}>
        <rect x={fx} y={fy} width={f.width * s.reveal} height={f.height ?? 4000} />
      </clipPath>,
    );
    clipPath = `url(#${uid}-clip)`;
  }

  let body: React.ReactNode = null;

  if (layer.type === "text") {
    const st = layer.style;
    const fontSize = st.fontSize ?? 64;
    const lineHeight = st.lineHeight ?? 1.05;
    const align = st.textAlign ?? "left";
    let raw = layer.text;
    if (st.textTransform === "uppercase") raw = raw.toUpperCase();
    if (st.textTransform === "lowercase") raw = raw.toLowerCase();
    const lines = wrapLines(raw, fontSize, st.maxWidth ?? f.width);
    const anchorX =
      align === "center" ? fx + (f.width ?? 0) / 2 : align === "right" ? fx + (f.width ?? 0) : fx;

    if (st.shadow) {
      defs.push(
        <filter key="s" id={`${uid}-shadow`} x="-40%" y="-40%" width="180%" height="200%">
          <feDropShadow
            dx={st.shadow.dx}
            dy={st.shadow.dy}
            stdDeviation={st.shadow.blur / 2}
            floodColor={st.shadow.color}
            floodOpacity={st.shadow.opacity ?? 1}
          />
        </filter>,
      );
      if (!filter) filter = `url(#${uid}-shadow)`;
    }

    body = (
      <text
        x={anchorX}
        // SVG text y is the baseline; approximate a CSS top-aligned box.
        y={fy + fontSize * 0.82}
        fontFamily={st.fontFamily ?? "sans-serif"}
        fontSize={fontSize}
        fontWeight={st.fontWeight ?? 700}
        fill={st.color ?? "#ffffff"}
        letterSpacing={st.letterSpacing ?? 0}
        textAnchor={align === "center" ? "middle" : align === "right" ? "end" : "start"}
        xmlSpace="preserve"
      >
        {lines.map((line, i) => (
          <tspan key={i} x={anchorX} dy={i === 0 ? 0 : fontSize * lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    );
  } else if (layer.type === "rect") {
    const st = layer.style;
    let fill = st.fill ?? "#ffffff";
    if (st.gradient) {
      defs.push(<Fragment key="g">{gradientDef(`${uid}-grad`, st.gradient)}</Fragment>);
      fill = `url(#${uid}-grad)`;
    }
    body = (
      <rect
        x={fx}
        y={fy}
        width={f.width ?? 0}
        height={f.height ?? 0}
        rx={st.radius ?? 0}
        fill={fill}
        fillOpacity={st.fillOpacity ?? 1}
        stroke={st.strokeColor}
        strokeWidth={st.strokeWidth ?? (st.strokeColor ? 2 : 0)}
      />
    );
  } else {
    const st = layer.style;
    if (st.radius) {
      defs.push(
        <clipPath key="ic" id={`${uid}-round`}>
          <rect x={fx} y={fy} width={f.width ?? 0} height={f.height ?? 0} rx={st.radius} />
        </clipPath>,
      );
    }
    body = (
      <image
        href={layer.src}
        x={fx}
        y={fy}
        width={f.width ?? 0}
        height={f.height ?? 0}
        preserveAspectRatio={st.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
        clipPath={st.radius ? `url(#${uid}-round)` : undefined}
      />
    );
  }

  return (
    <g opacity={s.opacity} transform={transformFor(layer, s)} filter={filter} clipPath={clipPath}>
      {defs.length > 0 && <defs>{defs}</defs>}
      {body}
    </g>
  );
}

/**
 * The composition stage: a single <svg> of native SVG primitives, so the exact
 * same node can be serialised and rasterised during export.
 */
export function CompositionStage({
  composition,
  time,
  stageRef,
}: {
  composition: Composition;
  time: number;
  stageRef?: React.Ref<SVGSVGElement>;
}) {
  const T = Math.max(0, Math.min(time, composition.duration));
  return (
    <svg
      ref={stageRef}
      width={composition.width}
      height={composition.height}
      viewBox={`0 0 ${composition.width} ${composition.height}`}
      xmlns="http://www.w3.org/2000/svg"
      data-anim-duration={composition.duration}
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      <rect
        x={0}
        y={0}
        width={composition.width}
        height={composition.height}
        fill={composition.background}
      />
      {composition.layers.map((layer) => (
        <LayerView key={layer.id} layer={layer} T={T} />
      ))}
    </svg>
  );
}
