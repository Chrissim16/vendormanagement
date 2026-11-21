import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * List filters, sorting and the open record live in the address, so a view survives a
 * reload and can be shared. Setting a key to an empty value removes it. Pass `push` for
 * a step the Back button should undo, such as opening a record.
 */
export function useUrlState<K extends string>(defaults: Record<K, string>) {
  const [params, setParams] = useSearchParams();
  const state = Object.fromEntries(Object.keys(defaults).map((k) => [k, params.get(k) ?? defaults[k as K]])) as Record<K, string>;
  const set = useCallback(
    (patch: Partial<Record<K, string>>, options: { push?: boolean } = {}) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch) as [K, string][]) {
            if (!v || v === defaults[k]) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: !options.push },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  );
  return [state, set] as const;
}

/** A page number from the address; anything that is not a positive whole number is page 1. */
export const pageNumber = (value: string) => (/^[1-9]\d*$/.test(value) ? Number(value) : 1);
