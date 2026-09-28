import { useCallback, useEffect, useRef, useState } from "react";
import { explain, type ApiError } from "./api";

export const REFRESH_EVENT = "dashboard:refresh";
export const refreshAll = () => window.dispatchEvent(new Event(REFRESH_EVENT));

/**
 * Load data for the current inputs, keeping the previous result on screen while a
 * new one loads (no flash, no layout jump) and discarding any answer that arrives
 * after a newer request has been made — so a fast click through filters never
 * shows the numbers for the filter before last.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], options: { enabled?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const seq = useRef(0);
  const enabled = options.enabled !== false;

  const run = useCallback(async () => {
    if (!enabled) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const value = await load();
      if (mine !== seq.current) return;
      setData(value);
      setError(null);
      setLoadedAt(new Date());
    } catch (e) {
      if (mine !== seq.current) return;
      setError(explain(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    void run();
  }, [run]);

  // Recover by itself when the connection comes back, and reload on the header's
  // "Refresh" button.
  useEffect(() => {
    const again = () => void run();
    window.addEventListener("online", again);
    window.addEventListener(REFRESH_EVENT, again);
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener(REFRESH_EVENT, again);
    };
  }, [run]);

  return { data, error, loading, loadedAt, reload: run, setData };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Session-storage state: survives navigation and reload in this tab only. */
export function useSessionState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        sessionStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* storage unavailable: state still works for this page */
      }
    },
    [key],
  );
  return [value, set];
}

/** Local preference (density, page size): per browser, never research data. */
export function usePreference<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`pref:${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(`pref:${key}`, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [value, set];
}
