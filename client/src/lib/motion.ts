/** Motion presets from the design guide. Things slide into place; nothing wiggles. */
export const ease = [0.2, 0.8, 0.2, 1] as const;
export const spring = { type: "spring", stiffness: 420, damping: 30, mass: 0.9 } as const;
export const bouncy = { type: "spring", stiffness: 380, damping: 22 } as const;

export const page = {
  initial: { x: 36, opacity: 0 },
  animate: { x: 0, opacity: 1, transition: { duration: 0.3, ease } },
  exit: { x: -28, opacity: 0, transition: { duration: 0.17, ease } },
};

/** Rows arrive one after another. Put `list` on the container and `item` on each row. */
export const list = { animate: { transition: { staggerChildren: 0.04 } } };
export const item = { initial: { x: 22, opacity: 0 }, animate: { x: 0, opacity: 1, transition: { duration: 0.3, ease } } };
