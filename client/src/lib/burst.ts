const colours = ["var(--accent)", "var(--primary)", "var(--ok)", "var(--warn)", "var(--crit)"];

/**
 * A short burst of small coloured squares from an element (design guide: accepting an AI
 * suggestion, finalising). Decoration only: it is skipped when the person asked for
 * reduced motion, and nothing waits for it.
 */
export function burst(from: Element | DOMRect | null | undefined, count = 12) {
  if (!from || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // A place measured earlier can be passed in, for a button that is gone by the time its action has succeeded.
  const box = from instanceof Element ? from.getBoundingClientRect() : from;
  for (let i = 0; i < count; i++) {
    const square = document.createElement("span");
    square.setAttribute("aria-hidden", "true");
    const size = 5 + Math.random() * 4;
    Object.assign(square.style, {
      position: "fixed",
      left: `${box.left + box.width / 2}px`,
      top: `${box.top + box.height / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "2px",
      background: colours[i % colours.length],
      pointerEvents: "none",
      zIndex: "60",
    });
    document.body.appendChild(square);
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const reach = 40 + Math.random() * 50;
    const flight = square.animate(
      [
        { transform: "translate(-50%, -50%) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(angle) * reach}px), calc(-50% + ${Math.sin(angle) * reach + 24}px)) rotate(${200 + Math.random() * 200}deg)`, opacity: 0 },
      ],
      { duration: 620 + Math.random() * 240, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
    flight.onfinish = flight.oncancel = () => square.remove();
  }
}
