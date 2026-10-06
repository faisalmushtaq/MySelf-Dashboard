#!/usr/bin/env node
/**
 * Split apps/web/demo/recording.json (./record.mjs) into what the demo build
 * loads, so the page opens quickly and no file is large:
 *
 *   data/firestore.json  documents the web app reads itself (bundled)
 *   data/live.json       session summaries, reviews, versions, policy (loaded on first use)
 *   data/calls.json      every recorded call; small answers inline
 *   data/calls/*.json    each large answer, loaded when that view opens
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const DEMO = new URL("../../apps/web/demo/", import.meta.url);
const DATA = new URL("data/", DEMO);
const recording = JSON.parse(readFileSync(new URL("recording.json", DEMO), "utf8"));
rmSync(DATA, { recursive: true, force: true });
mkdirSync(new URL("calls/", DATA), { recursive: true });

const study = recording.study;
// What the web app reads itself, in every study (docs/12).
const webReads = /^studies\/[a-z][a-z0-9_]*\/(releases|exportJobs|auditLog|savedViews|meta)\//;
const firestore = {};
const live = {};
for (const [path, value] of Object.entries(recording.firestore)) (webReads.test(path) ? firestore : live)[path] = value;
writeFileSync(new URL("firestore.json", DATA), JSON.stringify({ study, uid: recording.uid, email: recording.email, documents: firestore }));
writeFileSync(new URL("live.json", DATA), JSON.stringify({ documents: live }));

// One entry per distinct request; the last recording of it wins.
const byRequest = new Map();
for (const c of recording.calls) if (c.status === 200) byRequest.set(`${c.name} ${JSON.stringify(c.data)}`, c);
const index = [];
let n = 0;
for (const c of byRequest.values()) {
  const body = JSON.stringify(c.body);
  if (body.length > 20_000) {
    const file = `c${String(++n).padStart(4, "0")}`;
    writeFileSync(new URL(`calls/${file}.json`, DATA), body);
    index.push({ name: c.name, data: c.data, status: c.status, file });
  } else index.push({ name: c.name, data: c.data, status: c.status, body: c.body });
}
writeFileSync(new URL("calls.json", DATA), JSON.stringify(index));
const kb = (f) => Math.round(readFileSync(new URL(f, DATA)).length / 1024);
console.log(`packed ${index.length} calls (${n} in their own files); firestore.json ${kb("firestore.json")} KB, live.json ${kb("live.json")} KB, calls.json ${kb("calls.json")} KB`);
