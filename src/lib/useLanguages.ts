import { useEffect, useState } from "react";
import { listLanguages } from "./api";
import { onKeyChanged } from "./events";
import { FALLBACK_LANGUAGES } from "./languages";
import type { Language } from "./types";

/**
 * Google's own list of what it will translate, with the bundled table standing
 * in until it arrives.
 *
 * The fetch is free — Google does not bill the languages endpoint — but it is
 * still a round trip, and both windows want the same answer, so the result is
 * cached for the lifetime of the webview and shared by every caller. Saving or
 * removing a key throws the cache away, because a different key may be a
 * different project with a different answer, and because the first key is what
 * turns the fetch from impossible into possible.
 *
 * A failure is not surfaced. There is nothing the user can do about it from a
 * language picker, the bundled list is a perfectly good answer, and the place
 * that *can* say something useful about a broken key — Settings — already does.
 */

let cache: Promise<Language[]> | null = null;

function load(): Promise<Language[]> {
  cache ??= listLanguages().catch(() => FALLBACK_LANGUAGES);
  return cache;
}

export function useLanguages(): Language[] {
  const [languages, setLanguages] = useState<Language[]>(FALLBACK_LANGUAGES);

  useEffect(() => {
    let live = true;
    void load().then((list) => {
      if (live && list.length > 0) setLanguages(list);
    });

    const un = onKeyChanged(() => {
      cache = null;
      void load().then((list) => {
        if (live && list.length > 0) setLanguages(list);
      });
    });

    return () => {
      live = false;
      un.then((f) => f());
    };
  }, []);

  return languages;
}
