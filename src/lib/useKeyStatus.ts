import { useEffect, useState } from "react";
import { keyStatus } from "./api";
import { onKeyChanged } from "./events";
import type { KeyStatus } from "./types";

/**
 * Whether an API key is saved — the one thing about it a webview may know.
 *
 * `null` while the first answer is in flight, which is a third state worth
 * having: "there is no key" and "we have not asked yet" should not look the
 * same, or the desk window flashes a set-up prompt at someone who set up months
 * ago.
 *
 * Rust announces every save and removal, so a key pasted into the desk window
 * reaches the pop-up without either being reloaded.
 */
export function useKeyStatus(): KeyStatus | null {
  const [status, setStatus] = useState<KeyStatus | null>(null);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      keyStatus()
        .then((s) => live && setStatus(s))
        .catch(() => live && setStatus({ present: false, hint: "" }));
    };

    refresh();
    const un = onKeyChanged(refresh);
    return () => {
      live = false;
      un.then((f) => f());
    };
  }, []);

  return status;
}
