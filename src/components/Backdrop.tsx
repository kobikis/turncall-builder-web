import { useEffect, useState } from "react";
import { Shader, Circle, FilmGrain, SolidColor, Swirl } from "shaders/react";

// An ambient wash behind the page header, on the GPU.
//
// The brief was "more professional", and a console earns that with density and
// hierarchy rather than with effects — so this is deliberately the smallest
// version of the idea: a slow, near-monochrome swirl of the theme's own
// background and accent, faded out before it reaches the content. It gives the
// top of the page depth and the product an identity; it never sits behind a
// table row, and at these values you notice it only when it is gone.
//
// Three constraints it holds, which is what keeps it from reading as decoration:
//
// - **The colors are the design tokens**, read from CSS rather than hardcoded,
//   so it follows the light/dark switch and any future rebrand for free.
// - **Reduced motion means no motion** — `speed: 0` renders a still frame
//   rather than pausing something that was already moving.
// - **It is masked in the shader, not in CSS.** The fade is a Circle mask on
//   the GPU; `mask-image` would cost a compositing pass for a worse edge.

// How tall the wash is, in CSS pixels. Short on purpose: it stops above the
// table, because a gradient behind a row is a legibility problem, not depth.
const HEIGHT = 260;

/** `a` mixed toward `b` by `amount` (0 = all a, 1 = all b), in sRGB.
 *
 * The accent is a button colour — chosen to be seen. Handing it straight to the
 * shader gives a bright orange disc that competes with the primary action it
 * sits behind, and `blend` alone could not take it far enough down without
 * flattening the gradient entirely. Mixing it toward the background first sets
 * the ceiling, so the shader is shaping a colour that is already quiet. */
function mix(a: string, b: string, amount: number): string {
  const channels = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ar, ag, ab] = channels(a);
  const [br, bg_, bb] = channels(b);
  const blend = (x: number, y: number) =>
    Math.round(x + (y - x) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${blend(ar, br)}${blend(ag, bg_)}${blend(ab, bb)}`;
}

/** Rough perceived brightness of a hex colour, 0..1. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The value of a CSS custom property on :root, or a fallback. */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value.trim() || fallback;
}

/** The theme's background and accent, re-read whenever the theme changes.
 *
 * The app sets `html[data-theme]` pre-paint and also honours the OS setting, so
 * both have to be watched: the attribute for an explicit choice, the media
 * query for "System". */
function useThemeColors() {
  const read = () => {
    const bg = token("--bg", "#131316");
    const accent = token("--primary", "#e87b35");
    // Derived from the background rather than from the theme name, so it holds
    // however the theme was chosen — and would still hold for a third theme.
    const dark = luminance(bg) < 0.5;
    return {
      bg,
      // A warm tint on white needs more accent to register at all than the
      // same tint on near-black, where a quarter is already plenty.
      glow: mix(bg, accent, dark ? 0.25 : 0.14),
      // Grain is calibrated to brightness, not taste: the same value that is
      // clearly visible on a dark composition disappears on a light one. These
      // are the library's own recommended bands for each.
      grain: dark ? 0.03 : 0.3,
    };
  };
  const [colors, setColors] = useState(read);

  useEffect(() => {
    const update = () => setColors(read());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    system.addEventListener("change", update);
    return () => {
      observer.disconnect();
      system.removeEventListener("change", update);
    };
  }, []);

  return colors;
}

/** Whether the viewer asked for less motion. Watched, not read once: the OS
 *  setting can change while the app is open. */
function useReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

export default function Backdrop() {
  const { bg, glow, grain } = useThemeColors();
  const reduced = useReducedMotion();

  return (
    <Shader
      // Behind the content and deaf to the cursor: it is scenery, and a canvas
      // that swallows a click on the New agent button is worse than no canvas.
      style={{
        position: "absolute",
        insetInlineStart: 0,
        insetBlockStart: 0,
        width: "100%",
        height: HEIGHT,
        zIndex: 0,
        pointerEvents: "none",
      }}
      aria-hidden="true"
    >
      {/* The page's own background, so the wash has something to sit on and the
          canvas never shows through as a seam against the layout. Unmasked, as
          the masking note says: the mask belongs on the detailed layer. */}
      <SolidColor color={bg} />

      {/* Two shades of one colour, literally: the background, and the
          background with a little accent mixed in. `detail` is near zero
          because this should have no features anyone can point at. */}
      <Swirl
        colorA={bg}
        colorB={glow}
        blend={55}
        detail={0.3}
        speed={reduced ? 0 : 0.1}
        colorSpace="oklch"
        maskSource="backdropFade"
      />

      {/* The fade, and the reason this is a corner glow rather than a cloud:
          a soft circle pinned off the top-right corner, away from the title and
          the description, which have to stay the highest-contrast things on the
          page. Centred behind the text it washed them out — measured by
          looking at it. */}
      <Circle
        id="backdropFade"
        visible={false}
        color="#ffffff"
        radius={1.5}
        softness={1}
        center={{ x: 0.95, y: 0 }}
      />

      {/* Last, and unmasked: it applies to the whole composition above it.
          Here for the gradient more than for the texture — two shades this
          close band badly without it — which is why the strength follows the
          background's brightness rather than being a constant. */}
      <FilmGrain strength={grain} />
    </Shader>
  );
}
