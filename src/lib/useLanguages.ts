import { useEffect, useState } from "react";
import { fetchLanguages } from "./api";
import { cacheLanguages, cachedLanguages } from "./languages";
import { onSettingsChanged } from "./events";
import type { Languages } from "./types";

/**
 * DeepL's language lists, refreshed in the background.
 *
 * Starts from the cached copy (or the built-in fallback) so the pickers are
 * never empty, then replaces it with whatever the account actually supports.
 * A failure here is not worth surfacing: without a key there is nothing to
 * fetch, and the cached lists are correct often enough to keep working from.
 */
export function useLanguages(): Languages {
  const [langs, setLangs] = useState<Languages>(cachedLanguages);

  useEffect(() => {
    let alive = true;

    const refresh = () => {
      fetchLanguages()
        .then((next) => {
          if (!alive || !next.source.length || !next.target.length) return;
          setLangs(next);
          cacheLanguages(next);
        })
        .catch(() => {
          /* No key yet, or offline — the cached lists stand. */
        });
    };

    refresh();
    // A key added in Settings makes the real lists reachable for the first time.
    const un = onSettingsChanged(refresh);
    return () => {
      alive = false;
      un.then((f) => f());
    };
  }, []);

  return langs;
}
