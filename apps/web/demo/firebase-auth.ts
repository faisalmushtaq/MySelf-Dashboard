import { DEMO_USER } from "./backend";

/**
 * Demo build: stands in for "firebase/auth". The visitor is always the demo
 * researcher; "Sign in with Google" signs straight back in.
 */

export type User = { uid: string; email: string; displayName: string; getIdToken: () => Promise<string> };
type Listener = (user: User | null) => void;

const user: User = { ...DEMO_USER, displayName: "Demo researcher", getIdToken: async () => "demo-token" };
const listeners = new Set<Listener>();
const auth: { currentUser: User | null } = { currentUser: user };
const tell = () => listeners.forEach((l) => l(auth.currentUser));

export type Auth = typeof auth;
export const browserSessionPersistence = {};
export const browserPopupRedirectResolver = {};
export const initializeAuth = () => auth;
export const getAuth = () => auth;
export const connectAuthEmulator = () => undefined;

export class GoogleAuthProvider {
  setCustomParameters(): void {}
  static credential(): object {
    return {};
  }
}

export function onIdTokenChanged(_auth: unknown, listener: Listener): () => void {
  listeners.add(listener);
  setTimeout(() => listener(auth.currentUser), 0);
  return () => listeners.delete(listener);
}

export async function signInWithPopup(): Promise<{ user: User }> {
  auth.currentUser = user;
  tell();
  return { user };
}
export const signInWithCredential = signInWithPopup;

export async function signOut(): Promise<void> {
  auth.currentUser = null;
  tell();
}
