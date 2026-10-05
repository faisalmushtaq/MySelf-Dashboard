import { callFunction } from "./backend";

/** Demo build: stands in for "firebase/functions", answering from ./backend.ts. */

export type Functions = { region: string };
export type HttpsCallableResult<T> = { data: T };
export const getFunctions = (): Functions => ({ region: "demo" });
export const connectFunctionsEmulator = () => undefined;

export function httpsCallable<Req, Res>(_fns: Functions, name: string) {
  return async (data?: Req): Promise<HttpsCallableResult<Res>> => ({ data: (await callFunction(name, data ?? null)) as Res });
}
