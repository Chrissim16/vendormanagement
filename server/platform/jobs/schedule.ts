/**
 * Runs a piece of work again and again while the app is up. A run that is still going
 * when the next one is due is not started a second time, and a failing run never stops
 * the app. Zero minutes means never. Returns the way to stop it.
 */
export function every(minutes: number, work: () => Promise<void>, checkEveryMs = 60_000): () => void {
  if (minutes <= 0) return () => {};
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await work();
    } catch (e) {
      console.error("Scheduled work failed:", (e as Error).message);
    } finally {
      busy = false;
    }
  };
  // The work itself decides what is due; this only wakes it up. The timer does not keep the process alive.
  const timer = setInterval(() => void tick(), Math.min(minutes * 60_000, checkEveryMs));
  timer.unref();
  return () => clearInterval(timer);
}
