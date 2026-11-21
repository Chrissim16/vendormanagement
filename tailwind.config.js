const v = (name) => `var(--${name})`;

/** Colours, radii and easing come from docs/design/design-guide.md through the CSS variables in client/src/styles.css. */
export default {
  content: ["./client/index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        rail: v("rail"),
        surface: v("surface"),
        sunk: v("sunk"),
        ink: { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3") },
        line: { DEFAULT: v("line"), 2: v("line-2") },
        accent: { DEFAULT: v("accent"), ink: v("accent-ink") },
        primary: { DEFAULT: v("primary"), on: v("on-primary") },
        tint: v("tint"),
        crit: v("crit"),
        warn: v("warn"),
        ok: v("ok"),
      },
      fontFamily: { sans: ['"Inter Variable"', '"Inter"', "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"] },
      borderRadius: { tile: "24px" },
      boxShadow: { float: "var(--shadow)" },
      transitionTimingFunction: { out: "cubic-bezier(.2,.8,.2,1)", spring: "cubic-bezier(.34,1.5,.5,1)" },
    },
  },
};
