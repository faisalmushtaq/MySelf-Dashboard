/** Demo build: stands in for "firebase/app". There is no Firebase project behind the demo. */
export type FirebaseApp = { name: string };
export function initializeApp(): FirebaseApp {
  return { name: "demo" };
}
