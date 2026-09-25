// Hand-written benchmark composition: 1080x1920, 8s, three scenes.
// Deliberately covers the rasterisation hazards we need to measure:
// web font, gradient, blur, drop shadow, clip reveal, rounded image, transforms.
import type { Composition, Layer } from "./schema";

const FONT = "'Space Grotesk', system-ui, sans-serif";

export const demoComposition: Composition = {
  version: 1,
  name: "Spike — AI report teaser",
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 8,
  background: "#0B0D12",
  fonts: [
    {
      family: "Space Grotesk",
      url: "https://fonts.gstatic.com/s/spacegrotesk/v16/V8mDoQDjQSkFtoMM3T6r8E7mPb54C-s.woff2",
      weight: "700",
    },
  ],
  scenes: [
    { id: "opening", name: "Opening", start: 0, duration: 2.6 },
    { id: "stats", name: "Statistics", start: 2.6, duration: 3.4 },
    { id: "cta", name: "CTA", start: 6, duration: 2 },
  ],
  layers: [
    // Ambient gradient wash (tests gradients + blur under rasterisation)
    {
      id: "glow",
      type: "rect",
      frame: { x: -240, y: -240, width: 1560, height: 1400 },
      style: {
        gradient: {
          type: "radial",
          angle: 0,
          stops: [
            { offset: 0, color: "#2B6BFF", opacity: 1 },
            { offset: 0.62, color: "#0B0D12", opacity: 0 },
          ],
        },
      },
      motion: {
        opacity: { from: 0, to: 0.75, start: 0, end: 1.2, ease: "outCubic" },
        scale: { from: 1.15, to: 1, start: 0, end: 3, ease: "outCubic" },
      },
    },

    // SCENE 1 — opening
    {
      id: "eyebrow",
      type: "text",
      in: 0,
      out: 2.7,
      frame: { x: 110, y: 620, width: 860 },
      text: "NEW REPORT",
      style: {
        fontFamily: FONT,
        fontSize: 40,
        fontWeight: 700,
        color: "#7FA6FF",
        letterSpacing: 8,
        textTransform: "uppercase",
      },
      motion: {
        opacity: { from: 0, to: 1, start: 0.15, end: 0.8, ease: "outCubic" },
        y: { from: 40, to: 0, start: 0.15, end: 0.9, ease: "outCubic" },
      },
    },
    {
      id: "title",
      type: "text",
      in: 0,
      out: 2.7,
      frame: { x: 110, y: 690, width: 880 },
      text: "AI that\nactually\nships",
      style: {
        fontFamily: FONT,
        fontSize: 148,
        fontWeight: 700,
        color: "#FFFFFF",
        lineHeight: 0.98,
        letterSpacing: -4,
        shadow: { dx: 0, dy: 24, blur: 60, color: "#000000", opacity: 0.55 },
      },
      motion: {
        opacity: { from: 0, to: 1, start: 0.35, end: 1, ease: "outCubic" },
        y: { from: 120, to: 0, start: 0.35, end: 1.3, ease: "outCubic" },
        blur: { from: 14, to: 0, start: 0.35, end: 1.1, ease: "outCubic" },
      },
    },
    {
      id: "rule",
      type: "rect",
      in: 0,
      out: 2.7,
      frame: { x: 110, y: 1180, width: 500, height: 8 },
      style: {
        gradient: {
          type: "linear",
          angle: 0,
          stops: [
            { offset: 0, color: "#2B6BFF" },
            { offset: 1, color: "#7FA6FF" },
          ],
        },
        radius: 4,
      },
      motion: { reveal: { from: 0, to: 1, start: 1, end: 1.8, ease: "inOutQuart" } },
    },

    // SCENE 2 — three statistics, staggered
    ...[
      { id: "s1", value: "62%", label: "of teams cannot ship AI to production", t: 2.7 },
      { id: "s2", value: "3.4x", label: "faster iteration with an autonomous operator", t: 3.5 },
      { id: "s3", value: "11 hrs", label: "saved per week on social operations", t: 4.3 },
    ].flatMap<Layer>(({ id, value, label, t }, i) => {
      const y = 560 + i * 380;
      const group: Layer[] = [
        {
          id: `${id}-card`,
          type: "rect" as const,
          in: 2.6,
          out: 6.05,
          frame: { x: 90, y, width: 900, height: 320 },
          style: {
            fill: "#FFFFFF",
            fillOpacity: 0.05,
            radius: 40,
            strokeColor: "rgba(127,166,255,0.28)",
            strokeWidth: 2,
          },
          motion: {
            opacity: { from: 0, to: 1, start: t, end: t + 0.5, ease: "outCubic" },
            y: { from: 70, to: 0, start: t, end: t + 0.7, ease: "outBack" },
          },
        },
        {
          id: `${id}-value`,
          type: "text" as const,
          in: 2.6,
          out: 6.05,
          frame: { x: 140, y: y + 46, width: 800 },
          text: value,
          style: {
            fontFamily: FONT,
            fontSize: 110,
            fontWeight: 700,
            color: "#FFFFFF",
            letterSpacing: -3,
          },
          motion: {
            opacity: { from: 0, to: 1, start: t + 0.12, end: t + 0.55, ease: "outCubic" },
            y: { from: 40, to: 0, start: t + 0.12, end: t + 0.75, ease: "outCubic" },
          },
        },
        {
          id: `${id}-label`,
          type: "text" as const,
          in: 2.6,
          out: 6.05,
          frame: { x: 140, y: y + 190, width: 780 },
          text: label,
          style: {
            fontFamily: FONT,
            fontSize: 38,
            fontWeight: 500,
            color: "#A9B4C7",
            lineHeight: 1.25,
          },
          motion: {
            opacity: { from: 0, to: 1, start: t + 0.25, end: t + 0.7, ease: "outCubic" },
          },
        },
      ];
      return group;
    }),

    // SCENE 3 — CTA
    {
      id: "cta-title",
      type: "text",
      in: 6,
      frame: { x: 110, y: 780, width: 880 },
      text: "Read the report",
      style: {
        fontFamily: FONT,
        fontSize: 118,
        fontWeight: 700,
        color: "#FFFFFF",
        letterSpacing: -3,
      },
      motion: {
        opacity: { from: 0, to: 1, start: 6.05, end: 6.6, ease: "outCubic" },
        scale: { from: 0.9, to: 1, start: 6.05, end: 6.9, ease: "outBack" },
      },
    },
    {
      id: "cta-pill",
      type: "rect",
      in: 6,
      frame: { x: 110, y: 960, width: 520, height: 120 },
      style: {
        gradient: {
          type: "linear",
          angle: 0,
          stops: [
            { offset: 0, color: "#2B6BFF" },
            { offset: 1, color: "#5C8BFF" },
          ],
        },
        radius: 60,
      },
      motion: {
        opacity: { from: 0, to: 1, start: 6.35, end: 6.8, ease: "outCubic" },
        y: { from: 40, to: 0, start: 6.35, end: 7, ease: "outCubic" },
      },
    },
    {
      id: "cta-pill-text",
      type: "text",
      in: 6,
      frame: { x: 110, y: 995, width: 520 },
      text: "Book a demo",
      style: {
        fontFamily: FONT,
        fontSize: 44,
        fontWeight: 700,
        color: "#FFFFFF",
        textAlign: "center",
      },
      motion: {
        opacity: { from: 0, to: 1, start: 6.45, end: 6.9, ease: "outCubic" },
        y: { from: 40, to: 0, start: 6.45, end: 7.05, ease: "outCubic" },
      },
    },
  ],
};
