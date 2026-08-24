import { useCallback, useEffect, useState } from "react";
import { fetchUsage, keyIsFree } from "../lib/api";
import { onHistoryChanged } from "../lib/events";
import type { Usage } from "../lib/types";

/**
 * This billing period's character usage, as DeepL reports it.
 *
 * Pro keys without a hard cap come back with an implausibly large limit, so the
 * bar is only drawn when the number looks like a real allowance.
 */
const PLAUSIBLE_LIMIT = 1e11;

const fmt = new Intl.NumberFormat();

export default function UsageMeter({ apiKey }: { apiKey: string }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [free, setFree] = useState(false);

  const refresh = useCallback(() => {
    if (!apiKey.trim()) {
      setUsage(null);
      return;
    }
    fetchUsage()
      .then(setUsage)
      .catch(() => setUsage(null));
    keyIsFree()
      .then(setFree)
      .catch(() => {});
  }, [apiKey]);

  useEffect(refresh, [refresh]);

  // A saved translation means characters were just spent; keep the meter honest.
  useEffect(() => {
    const un = onHistoryChanged(refresh);
    return () => {
      un.then((f) => f());
    };
  }, [refresh]);

  if (!usage) return null;

  const metered =
    usage.characterLimit > 0 && usage.characterLimit < PLAUSIBLE_LIMIT;
  const pct = metered
    ? Math.min(100, (usage.characterCount / usage.characterLimit) * 100)
    : 0;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {free ? "Free quota" : "Usage"}
        </span>
        <span className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
          {metered ? `${Math.round(pct)}%` : fmt.format(usage.characterCount)}
        </span>
      </div>

      {metered ? (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className={[
                "h-full rounded-full transition-[width] duration-500",
                pct > 90
                  ? "bg-rose-500"
                  : pct > 75
                    ? "bg-amber-500"
                    : "bg-iris-500",
              ].join(" ")}
              style={{ width: `${Math.max(pct, 1)}%` }}
            />
          </div>
          <p className="mt-1 text-[10.5px] tabular-nums text-slate-400 dark:text-slate-500">
            {fmt.format(usage.characterCount)} / {fmt.format(usage.characterLimit)}
          </p>
        </>
      ) : (
        <p className="text-[10.5px] text-slate-400 dark:text-slate-500">
          characters this period
        </p>
      )}
    </div>
  );
}
