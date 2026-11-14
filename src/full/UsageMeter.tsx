import { useCallback, useEffect, useState } from "react";
import { fetchUsage } from "../lib/api";
import { onKeyChanged, onUsageChanged } from "../lib/events";
import type { Usage } from "../lib/types";

/**
 * How much of this month's free tier is gone, and what the overflow costs.
 *
 * Google bills the Cloud Translation API by the character — the first 500,000
 * each calendar month free, $20 per million after that — and publishes no
 * running total: the real figure lives in Cloud Billing, hours behind. So this
 * is Lingo's own tally of what it has sent, which is close but not
 * authoritative: anything else on the same project spends the same free tier.
 * The footnote says so rather than letting the bar imply a precision it does
 * not have.
 */

const fmt = new Intl.NumberFormat();
const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

export default function UsageMeter() {
  const [usage, setUsage] = useState<Usage | null>(null);

  const refresh = useCallback(() => {
    fetchUsage()
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  useEffect(refresh, [refresh]);

  // The pop-up spends most of the allowance, and it is a different webview.
  // Rust announces every translation so this meter hears about them.
  useEffect(() => {
    const un = Promise.all([onUsageChanged(refresh), onKeyChanged(refresh)]);
    return () => {
      un.then((fns) => fns.forEach((f) => f()));
    };
  }, [refresh]);

  if (!usage) return null;

  // The bar fills towards the user's own limit, where Lingo stops sending.
  const share = Math.min(100, (usage.characters / Math.max(1, usage.limit)) * 100);
  const over = Math.max(0, usage.characters - usage.freeTier);
  const cost = (over / 1_000_000) * usage.usdPerMillion;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          This month
        </span>
        <span className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
          {over > 0 ? `≈ ${money.format(cost)}` : `${Math.round(share)}%`}
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className={[
            "h-full rounded-full transition-[width] duration-500",
            usage.quotaBlocked || share >= 100
              ? "bg-rose-500"
              : share > 75 || over > 0
                ? "bg-amber-500"
                : "bg-iris-500",
          ].join(" ")}
          style={{ width: `${Math.max(share, 1)}%` }}
        />
      </div>

      <p className="mt-1 text-[10.5px] tabular-nums text-slate-400 dark:text-slate-500">
        {fmt.format(usage.characters)} / {fmt.format(usage.limit)} characters
      </p>

      {share >= 100 ? (
        <p className="mt-0.5 text-[10px] font-medium leading-snug text-rose-600 dark:text-rose-400">
          Your monthly limit is reached. Lingo sends nothing more until next
          month, or until you raise it in Settings.
        </p>
      ) : usage.quotaBlocked ? (
        <p className="mt-0.5 text-[10px] font-medium leading-snug text-rose-600 dark:text-rose-400">
          Google last refused this project for quota.
        </p>
      ) : (
        <p className="mt-0.5 text-[10px] leading-snug text-slate-400 dark:text-slate-500">
          {over > 0
            ? `Past the free tier — about ${money.format(cost)} so far, at $${usage.usdPerMillion} per million.`
            : usage.limit <= usage.freeTier
              ? "Your limit is inside Google's free tier. Lingo's own count — Google keeps the real one."
              : "Lingo's own count — Google keeps the real one."}
        </p>
      )}
    </div>
  );
}
