import type { MouseEvent } from "react";

/** Switches light and dark. The new theme spreads in a circle from the button that was pressed. */
export function toggleTheme(e: MouseEvent<HTMLElement>) {
  const root = document.documentElement;
  const apply = () => {
    const next = root.dataset.mode === "dark" ? "light" : "dark";
    root.dataset.mode = next;
    try {
      localStorage.setItem("mode", next);
    } catch {
      // The choice simply does not persist.
    }
  };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!("startViewTransition" in document) || reduced) return apply();
  const r = e.currentTarget.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  document
    .startViewTransition(apply)
    .ready.then(() =>
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(150vmax at ${x}px ${y}px)`] },
        { duration: 560, easing: "cubic-bezier(.2,.8,.2,1)", pseudoElement: "::view-transition-new(root)" },
      ),
    )
    .catch(() => undefined);
}
