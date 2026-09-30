import { documents, onDocumentsChanged, touchDocuments, useTimestamps } from "./backend";

/**
 * Demo build: stands in for "firebase/firestore" with an in-memory copy of the
 * few collections the web app reads itself (recorded from the emulators).
 * Queries support what the app uses: where, orderBy, limit, startAfter.
 */

export class Timestamp {
  constructor(
    readonly seconds: number,
    readonly nanoseconds: number,
  ) {}
  static fromMillis(ms: number): Timestamp {
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  static fromDate(d: Date): Timestamp {
    return Timestamp.fromMillis(d.getTime());
  }
  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now());
  }
  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toDate(): Date {
    return new Date(this.toMillis());
  }
  isEqual(other: Timestamp): boolean {
    return other instanceof Timestamp && other.toMillis() === this.toMillis();
  }
  valueOf(): string {
    return String(this.toMillis()).padStart(16, "0");
  }
}

useTimestamps((ms) => Timestamp.fromMillis(ms));

type Data = Record<string, unknown>;
type Constraint =
  | { type: "where"; field: string; op: string; value: unknown }
  | { type: "orderBy"; field: string; dir: "asc" | "desc" }
  | { type: "limit"; n: number }
  | { type: "startAfter"; snap: QueryDocumentSnapshot };
export type QueryConstraint = Constraint;
export type Firestore = { name: string };
type CollectionRef = { kind: "collection"; path: string; constraints: Constraint[] };
type DocRef = { kind: "doc"; path: string; id: string };

export const getFirestore = (): Firestore => ({ name: "demo" });
export const connectFirestoreEmulator = () => undefined;
export const collection = (_db: unknown, path: string): CollectionRef => ({ kind: "collection", path, constraints: [] });
export const doc = (_db: unknown, path: string): DocRef => ({ kind: "doc", path, id: path.split("/").pop()! });
export const where = (field: string, op: string, value: unknown): Constraint => ({ type: "where", field, op, value });
export const orderBy = (field: string, dir: "asc" | "desc" = "asc"): Constraint => ({ type: "orderBy", field, dir });
export const limit = (n: number): Constraint => ({ type: "limit", n });
export const startAfter = (snap: QueryDocumentSnapshot): Constraint => ({ type: "startAfter", snap });
export const query = (ref: CollectionRef, ...constraints: Constraint[]): CollectionRef => ({ ...ref, constraints: [...ref.constraints, ...constraints] });
export const serverTimestamp = () => Timestamp.now();

export class QueryDocumentSnapshot {
  constructor(
    readonly id: string,
    readonly ref: DocRef,
    private readonly value: Data | undefined,
  ) {}
  exists(): boolean {
    return this.value !== undefined;
  }
  data(): Data | undefined {
    return this.value ? structuredCloneData(this.value) : undefined;
  }
  get(field: string): unknown {
    return this.value?.[field];
  }
}
export type DocumentSnapshot = QueryDocumentSnapshot;

// Timestamps survive a copy; everything else is plain data.
function structuredCloneData(v: Data): Data {
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x]));
}

const comparable = (v: unknown): unknown => (v instanceof Timestamp ? v.toMillis() : v);
function compare(a: unknown, b: unknown): number {
  const x = comparable(a);
  const y = comparable(b);
  if (x === y) return 0;
  if (x === undefined || x === null) return -1;
  if (y === undefined || y === null) return 1;
  return (x as number) < (y as number) ? -1 : 1;
}
function matches(value: unknown, op: string, target: unknown): boolean {
  const c = compare(value, target);
  switch (op) {
    case "==":
      return c === 0;
    case "!=":
      return c !== 0;
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    case ">":
      return c > 0;
    case ">=":
      return c >= 0;
    case "in":
      return Array.isArray(target) && target.some((t) => compare(value, t) === 0);
    case "array-contains":
      return Array.isArray(value) && value.some((t) => compare(t, target) === 0);
    default:
      return false;
  }
}

function run(ref: CollectionRef): QueryDocumentSnapshot[] {
  const prefix = ref.path + "/";
  let rows = [...documents().entries()]
    .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
    .map(([path, value]) => new QueryDocumentSnapshot(path.slice(prefix.length), { kind: "doc", path, id: path.slice(prefix.length) }, value));
  for (const c of ref.constraints) if (c.type === "where") rows = rows.filter((r) => matches(r.get(c.field), c.op, c.value));
  const orders = ref.constraints.filter((c): c is Extract<Constraint, { type: "orderBy" }> => c.type === "orderBy");
  rows.sort((a, b) => {
    for (const o of orders) {
      const c = compare(a.get(o.field), b.get(o.field));
      if (c !== 0) return o.dir === "desc" ? -c : c;
    }
    return a.id.localeCompare(b.id);
  });
  const after = ref.constraints.find((c): c is Extract<Constraint, { type: "startAfter" }> => c.type === "startAfter");
  if (after) rows = rows.slice(rows.findIndex((r) => r.id === after.snap.id) + 1);
  const lim = ref.constraints.find((c): c is Extract<Constraint, { type: "limit" }> => c.type === "limit");
  return lim ? rows.slice(0, lim.n) : rows;
}

const querySnapshot = (docs: QueryDocumentSnapshot[]) => ({ docs, size: docs.length, empty: docs.length === 0, forEach: (f: (d: QueryDocumentSnapshot) => void) => docs.forEach(f) });
const docSnapshot = (ref: DocRef) => new QueryDocumentSnapshot(ref.id, ref, documents().get(ref.path));

export async function getDocs(ref: CollectionRef) {
  return querySnapshot(run(ref));
}
export async function getDoc(ref: DocRef) {
  return docSnapshot(ref);
}

export function onSnapshot(ref: CollectionRef | DocRef, next: (snap: never) => void): () => void {
  const emit = () => next((ref.kind === "doc" ? docSnapshot(ref) : querySnapshot(run(ref))) as never);
  const stop = onDocumentsChanged(emit);
  setTimeout(emit, 0);
  return stop;
}

export async function addDoc(ref: CollectionRef, data: Data): Promise<DocRef> {
  const id = Math.random().toString(36).slice(2, 12);
  const path = `${ref.path}/${id}`;
  documents().set(path, { ...data });
  touchDocuments();
  return { kind: "doc", path, id };
}
export async function updateDoc(ref: DocRef, data: Data): Promise<void> {
  documents().set(ref.path, { ...(documents().get(ref.path) ?? {}), ...data });
  touchDocuments();
}
export async function deleteDoc(ref: DocRef): Promise<void> {
  documents().delete(ref.path);
  touchDocuments();
}
