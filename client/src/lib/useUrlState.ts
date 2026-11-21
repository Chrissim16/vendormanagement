import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * List filters, sorting and the open record live in the address, so a view survives a
 * reload and can be shared. Setting a key to an empty value removes it.
 */
export function useUrlState<K extends string>(defaults: Record<K, string>) {
  const [params, setParams] = useSearchParams();
  const state = Object.fromEntries(Object.keys(defaults).map((k) => [k, params.get(k) ?? defaults[k as K]])) as Record<K, string>;
  const set = useCallback(
    (patch: Partial<Record<K, string>>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch) as [K, string][]) {
            if (!v || v === defaults[k]) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  );
  return [state, set] as const;
}
