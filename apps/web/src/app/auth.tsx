import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GoogleAuthProvider, onIdTokenChanged, signInWithCredential, signInWithPopup, signOut as fbSignOut, type User } from "firebase/auth";
import type { Capability, WhoAmIResponse } from "@myself-dashboard/core";
import { api, explain } from "../lib/api";
import { configured, firebase, googleProvider, USE_EMULATORS } from "../lib/firebase";
import { setTimeZone } from "../lib/format";

/**
 * Who is signed in, and what the dashboard says they may do.
 *
 * Signing in with Google says who you are; `whoAmI` says whether the study knows
 * you. The answer is checked on the server (and again on every call and by the
 * security rules), so nothing here is a control — it decides what to SHOW.
 */

export type AuthState =
  | { kind: "unconfigured" }
  | { kind: "loading" }
  | { kind: "signed_out"; notice?: string }
  | { kind: "denied"; email: string | null; reason: string }
  | { kind: "error"; message: string }
  | { kind: "authorised"; user: User; me: WhoAmIResponse };

interface AuthApi {
  state: AuthState;
  signIn: () => Promise<void>;
  signInEmulator: (email: string) => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
  retry: () => void;
  can: (c: Capability) => boolean;
  me: WhoAmIResponse | null;
}

const Ctx = createContext<AuthApi | null>(null);

const IDLE_MS = 30 * 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(configured ? { kind: "loading" } : { kind: "unconfigured" });
  const [attempt, setAttempt] = useState(0);
  const pendingNotice = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!configured) return;
    const { auth } = firebase();
    return onIdTokenChanged(auth, async (user) => {
      if (!user) {
        setState({ kind: "signed_out", ...(pendingNotice.current ? { notice: pendingNotice.current } : {}) });
        pendingNotice.current = undefined;
        return;
      }
      setState((s) => (s.kind === "authorised" && s.user.uid === user.uid ? s : { kind: "loading" }));
      try {
        const key = `signed-in:${user.uid}`;
        const first = sessionStorage.getItem(key) === null;
        const me = await api.whoAmI({ signIn: first });
        if (!me.authorised) {
          setState({ kind: "denied", email: me.email ?? user.email, reason: me.reason ?? "This account is not permitted." });
          return;
        }
        sessionStorage.setItem(key, "1");
        if (me.policy) setTimeZone(me.policy.timeZone);
        setState({ kind: "authorised", user, me });
      } catch (e) {
        setState({ kind: "error", message: explain(e).message });
      }
    });
  }, [attempt]);

  const signOut = useCallback(async (notice?: string) => {
    pendingNotice.current = notice;
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    await fbSignOut(firebase().auth);
  }, []);

  // Sign out after 30 minutes without interaction: research data should not sit
  // open on an unattended screen.
  useEffect(() => {
    if (state.kind !== "authorised") return;
    let last = Date.now();
    const touch = () => {
      last = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - last > IDLE_MS) void signOut("You were signed out after 30 minutes without activity.");
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(timer);
    };
  }, [state.kind, signOut]);

  const value = useMemo<AuthApi>(() => {
    const me = state.kind === "authorised" ? state.me : null;
    return {
      state,
      me,
      can: (c) => !!me?.capabilities.includes(c),
      retry: () => setAttempt((a) => a + 1),
      signOut,
      signIn: async () => {
        try {
          await signInWithPopup(firebase().auth, googleProvider());
        } catch (e) {
          const code = (e as { code?: string }).code ?? "";
          if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
          if (code === "auth/popup-blocked") {
            setState({ kind: "signed_out", notice: "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again." });
            return;
          }
          setState({ kind: "signed_out", notice: "Sign-in did not complete. Check your connection and try again." });
        }
      },
      // Emulator builds only: the Auth emulator accepts an unsigned Google identity.
      signInEmulator: async (email: string) => {
        if (!USE_EMULATORS) return;
        const cred = GoogleAuthProvider.credential(JSON.stringify({ sub: `google-${email}`, email, email_verified: true, name: email.split("@")[0] }));
        await signInWithCredential(firebase().auth, cred);
      },
    };
  }, [state, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
