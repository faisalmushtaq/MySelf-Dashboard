/**
 * A made-up YBM study for the dashboard demo: sittings under the REAL survey
 * releases (r8.0.0 and r9.0.0), answered at random by invented children.
 *
 * Nothing here is, or is derived from, participant data. Names, dates of birth
 * and schools are invented; every address is a university campus. The answers
 * follow each release's display rules, as a device would, and a hidden
 * "wellbeing" trait per child makes the standard measures hang together, so the
 * charts have something to show. Seeded, so every run gives the same study.
 *
 * The three sittings the real survey app recorded in its own browser test
 * (packages/core/src/survey/fixtures/r9-scenarios.json) are added as they are.
 */
import { readFileSync } from "node:fs";
import { AnswerStore, evaluate, indexRelease, validateAnswer } from "@myself-dashboard/core";
import { prng, ulid } from "@myself-dashboard/core/node";

const ROOT = new URL("../../", import.meta.url);
export const readRelease = (version) => JSON.parse(readFileSync(new URL(`releases/ybm_nd2026_standard_r${version}.manifest.json`, ROOT), "utf8"));
export const scenarioSittings = () =>
  JSON.parse(readFileSync(new URL("packages/core/src/survey/fixtures/r9-scenarios.json", ROOT), "utf8")).sessions;

/** Schools: invented, and named as such. */
export const SCHOOLS = { NTH: "Sample School North", STH: "Sample School South", WST: "Sample School West", SCN: "Survey app test walks" };
const SCHOOL_EFFECT = { NTH: 0.3, STH: 0, WST: -0.25 };

const FIRST = ["Aisha", "Oliver", "Maryam", "Jack", "Zainab", "Harry", "Amelia", "Muhammad", "Olivia", "Ibrahim", "Isla", "Noah", "Hafsa", "George", "Lily", "Yusuf", "Ava", "Leo", "Sofia", "Ali", "Grace", "Adam", "Freya", "Hamza", "Emily", "Theo", "Aleksandra", "Oscar", "Khadija", "Ruby"];
const LAST = ["Khan", "Smith", "Hussain", "Jones", "Ahmed", "Taylor", "Ali", "Brown", "Begum", "Wilson", "Kowalski", "Patel", "Evans", "Shah", "Walker", "Iqbal", "Wright", "Nowak", "Thompson", "Mahmood"];
const CAMPUSES = [
  { postcode: "LS2 9JT", house: "University of Leeds", street: "Woodhouse Lane" },
  { postcode: "BD7 1DP", house: "University of Bradford", street: "Richmond Road" },
  { postcode: "HD1 3DH", house: "University of Huddersfield", street: "Queensgate" },
];
const GAMES = ["Minecraft", "Fortnite", "EA Sports FC", "Roblox", "Rocket League", "Mario Kart", "Among Us", "Pokémon", "Clash Royale", "Forza"];
const MESSAGES = [
  "Keep going, it gets better.",
  "Remember to be kind to yourself.",
  "I hope you still play football on Saturdays.",
  "Don't stress about exams, you did your best.",
  "Say hi to Nan for me.",
  "I hope you learned to play the guitar.",
  "Stay close to your friends.",
];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const at = (ms) => new Date(ms).toISOString();

function normal(rnd) {
  const u = Math.max(1e-9, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

function weighted(rnd, n, power) {
  const w = Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, power));
  let x = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i += 1) {
    x -= w[i];
    if (x <= 0) return i;
  }
  return n - 1;
}

/** Where on an ordinal scale (0 = first option, 1 = last) a child with trait z lands. */
function ordinalPosition(q, z, hand, rnd) {
  const n = Number(q.item.replace(/\D/g, "")) || 0;
  const noise = () => 0.13 * normal(rnd);
  switch (q.instrument) {
    case "swemwbs":
      return 0.62 + 0.17 * z + noise();
    case "sqs":
      return 0.6 + 0.14 * z + noise();
    case "kss":
      return 0.45 - 0.12 * z + noise();
    case "macarthur_ssy":
      return 0.58 + 0.12 * z + noise();
    case "rcads25":
      return 0.28 - 0.16 * z + noise();
    case "stai5_s":
      return 0.33 - 0.14 * z + noise();
    case "doomscroll4":
      return 0.42 - 0.1 * z + noise();
    case "ehi_sf":
      if (hand < 0.1) return 0.9 + 0.1 * rnd();
      if (hand < 0.13) return 0.3 + 0.4 * rnd();
      return 0.1 * rnd();
    case "sdq25_s":
    case "sdq25_s18":
      // Prosocial items rise with wellbeing, as do the positively worded ones (7, 11, 14, 21, 25); the rest fall.
      if ([1, 4, 9, 17, 20].includes(n)) return 0.8 + 0.1 * z + noise();
      if ([7, 11, 14, 21, 25].includes(n)) return 0.85 + 0.17 * z + noise();
      return 0.24 - 0.18 * z + 1.4 * noise();
    default:
      return null;
  }
}

function choose(q, child, rnd) {
  const options = q.options ?? [];
  const pos = ordinalPosition(q, child.z, child.hand, rnd);
  if (pos !== null) return options[Math.round(clamp01(pos) * (options.length - 1))].code;
  if (q.key === "ybm_intro_consent.linkage_consent") return rnd() < 0.82 ? 1 : 2;
  if (q.key === "ybm_demographics.ethnicity") return options[weighted(rnd, options.length, 1.15)].code;
  if (q.key === "ybm_demographics.first_language_english") return child.englishFirst ? options[0].code : options[weighted(rnd, options.length - 1, 1) + 1].code;
  if (q.key === "ybm_demographics.speaks_other_language") return child.otherLanguages ? 1 : 2;
  if (q.key === "ybm_smartphone.own") return rnd() < 0.88 ? 1 : 2;
  if (q.key === "ybm_social_media.family_control") return rnd() < 0.3 ? 1 : 2;
  if (options.length <= 3) return options[weighted(rnd, options.length, 1.4)].code;
  return options[Math.round(clamp01(0.4 + 0.22 * normal(rnd)) * (options.length - 1))].code;
}

function answerFor(q, child, rnd, templates) {
  switch (q.responseType) {
    case "single_choice":
      return { kind: "choice", code: choose(q, child, rnd) };
    case "multi_choice": {
      const options = q.options ?? [];
      const min = Number(q.constraints.minSelections ?? 0);
      let codes;
      if (q.key === "ybm_demographics.other_languages") {
        codes = [...new Set([options[weighted(rnd, options.length, 1.3)].code, ...(rnd() < 0.25 ? [options[weighted(rnd, options.length, 1.3)].code] : [])])];
      } else {
        codes = options.map((o) => o.code).filter(() => rnd() < 0.35);
        while (codes.length < min) codes.push(options[Math.floor(rnd() * options.length)].code);
        codes = [...new Set(codes)].sort((a, b) => a - b);
      }
      return { kind: "multi", codes };
    }
    case "numeric":
      // Most say a few days; now and then someone claims a year or more.
      return { kind: "number", value: rnd() < 0.05 ? 365 + Math.floor(rnd() * 400) : Math.round(Math.exp(rnd() * 4)) };
    case "slider":
      return { kind: "number", value: Math.round(clamp01(0.45 + 0.25 * normal(rnd)) * 100) };
    case "ladder":
      return { kind: "number", value: 1 + Math.round(clamp01(ordinalPosition(q, child.z, child.hand, rnd) ?? rnd()) * 9) };
    case "text_short":
      if (q.key === "ybm_identity.first_name") return { kind: "text", value: child.first };
      if (q.key === "ybm_identity.last_name") return { kind: "text", value: child.last };
      if (q.key === "ybm_demographics.other_language_named") return { kind: "text", value: ["Pashto", "Somali", "Kurdish", "Romanian", "Tigrinya"][Math.floor(rnd() * 5)] };
      return { kind: "text", value: ["They check who I follow", "My mum has my password", "Only on weekends"][Math.floor(rnd() * 3)] };
    case "text_long":
      return { kind: "text", value: MESSAGES[Math.floor(rnd() * MESSAGES.length)] };
    case "date":
      return { kind: "date", iso: child.dob };
    case "form_fields":
      if (q.key === "ybm_identity.home_address") return { kind: "fields", values: { ...child.address } };
      return {
        kind: "fields",
        values: Object.fromEntries((q.constraints.fields ?? []).map((f, i) => [f.key, i < 1 + Math.floor(rnd() * 3) ? GAMES[Math.floor(rnd() * GAMES.length)] : ""])),
      };
    case "rank_group": {
      let rank = 0;
      const assignments = Object.fromEntries(
        (q.options ?? []).map((o) => [String(o.code), rnd() < 0.45 ? { group: "have", rank: ++rank } : { group: "dont_have" }]),
      );
      return { kind: "group_rank", assignments };
    }
    case "checkbox_set":
      return { kind: "checkboxes", checked: (q.constraints.statements ?? []).map((s) => s.key) };
    default:
      return templates.get(q.key);
  }
}

/**
 * One sitting, walked in order through the questions its release shows, with
 * the events the participant app records.
 */
function walk({ idx, child, start, code, rnd, templates, stopAfter, skipRate = 0, tooFast = false, decline = false }) {
  const events = [];
  const store = new AnswerStore();
  let t = start;
  let mono = 300;
  const push = (type, itemKey, payload) => events.push({ seq: events.length, type, ...(itemKey ? { itemKey } : {}), ...(payload ? { payload } : {}), tWall: at(t), tMono: mono });
  const tick = (ms) => {
    t += ms;
    mono += ms;
  };
  push("session.started", undefined, { releaseHash: idx.hash, val_id: code });
  let asked = 0;
  let declined = false;
  for (const q of idx.questions) {
    if (q.displayIf && !evaluate(q.displayIf, store, new Date(start))) continue;
    if (stopAfter !== undefined && asked >= stopAfter) return { events, end: t, mono, finished: false };
    asked += 1;
    const [instrument, item] = q.key.split(".");
    const ref = { instrument, item, revision: q.revision ?? 1 };
    const threshold = 1500;
    const dwell = tooFast ? 500 + Math.floor(rnd() * 500) : 2500 + Math.floor(rnd() * 9000);
    push("item.presented", q.key, { visit: 1, returning: false, tooFastMs: threshold });
    tick(dwell);
    if (decline && !declined && q.allowDecline) {
      declined = true;
      push("item.declined", q.key);
      store.set(ref, { status: "declined" });
    } else if (q.required !== "hard" && rnd() < skipRate) {
      push("skip.confirmed", q.key);
      push("item.skipped", q.key);
      store.set(ref, { status: "skipped" });
    } else {
      let value = answerFor(q, child, rnd, templates);
      if (!value || !validateAnswer(q, value).valid) value = templates.get(q.key);
      if (!value) {
        push("item.skipped", q.key);
        store.set(ref, { status: "skipped" });
      } else {
        push("response.recorded", q.key, { value, timing: { sinceShownMs: dwell, tooFast: dwell < threshold, thresholdMs: threshold, changes: 0, timeToFirstResponseMs: dwell } });
        if (dwell < threshold) push("response.too_fast", q.key, { sinceShownMs: dwell, thresholdMs: threshold, run: 1 });
        store.set(ref, { status: "answered", value });
      }
    }
    tick(250);
    push("item.left", q.key, { visit: 1, visitDwellMs: dwell, totalDwellMs: dwell, answered: true });
  }
  tick(1500);
  push("session.completed", undefined, { totalMs: mono, foregroundMs: Math.round(mono * 0.97) });
  return { events, end: t, mono, finished: true };
}

/** The last answer each scenario sitting gave, per question: the fallback for shapes not generated here. */
function templatesFrom(sittings) {
  const out = new Map();
  for (const s of sittings) for (const e of s.events) if ((e.type === "response.recorded" || e.type === "response.changed") && e.itemKey) out.set(e.itemKey, e.payload.value);
  return out;
}

/** Date of birth for a child in school Year `year` on 1 September 2026 (Year 7 were 11 on 31 August). */
function dobFor(year, rnd) {
  const born = Date.UTC(2026 - year - 5, 8, 1) + Math.floor(rnd() * 364) * 86_400_000;
  return at(born).slice(0, 10);
}

/** School-day start times in London, spread over the dates given. */
function schoolTime(dayMs, rnd) {
  const d = new Date(dayMs);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(8 + Math.floor(rnd() * 6), Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
  return d.getTime();
}

/**
 * The study: `count` sittings from September 2026 under r9.0.0, and a first wave
 * in June 2026 under r8.0.0 for some of the same children, plus the three
 * sittings the real survey app recorded. `later` adds `count` sittings on `day`
 * under each `manifest` given, for versions published after these.
 */
export function generateYbmStudy({ count = 64, seed = 20260930, now = new Date(), study = "ybm", later = [] } = {}) {
  const rnd = prng(seed);
  const scenarios = scenarioSittings();
  const templates = templatesFrom(scenarios);
  const r9 = indexRelease(readRelease("9.0.0"));
  const r8 = indexRelease(readRelease("8.0.0"));
  const sites = ["NTH", "STH", "WST"];
  const years = [7, 7, 8, 8, 9, 9, 10, 10, 11, 12, 13];
  const newChild = (i, rnd) => {
    const site = sites[i % 3];
    const year = years[Math.floor(rnd() * years.length)];
    return {
      site,
      first: FIRST[Math.floor(rnd() * FIRST.length)],
      last: LAST[Math.floor(rnd() * LAST.length)],
      dob: dobFor(year, rnd),
      address: CAMPUSES[i % CAMPUSES.length],
      z: normal(rnd) + (SCHOOL_EFFECT[site] ?? 0) - 0.06 * (year - 7),
      hand: rnd(),
      englishFirst: rnd() < 0.72,
      otherLanguages: rnd() < 0.42,
    };
  };
  const children = Array.from({ length: count }, (_, i) => newChild(i, rnd));

  const plan = [];
  const kinds = ["incomplete", "incomplete", "incomplete", "abandoned", "abandoned", "abandoned", "in_progress", "in_progress", "speeder", "speeder", "declined", "test"];
  children.forEach((child, i) => plan.push({ child, kind: kinds[i] ?? (rnd() < 0.08 ? "incomplete" : "complete"), idx: r9 }));
  // A first wave in June for every fifth child: the Participants page links the two by name and date of birth.
  children.forEach((child, i) => {
    if (i % 5 === 2) plan.push({ child, kind: "complete", idx: r8, june: true });
  });

  const septStart = Date.parse("2026-09-07T00:00:00.000Z");
  const septSpan = Date.parse("2026-09-29T00:00:00.000Z") - septStart;
  const juneStart = Date.parse("2026-06-08T00:00:00.000Z");
  const out = [];
  const sitting = (opts, n, kind) => {
    const { idx, start, code, rnd } = opts;
    const w = walk(opts);
    return {
      sessionId: `ses_${ulid(start, rnd)}`,
      deviceId: `inst_demo_${(n % 4) + 1}`,
      study,
      studyCode: code,
      releaseKey: idx.key,
      releaseHash: idx.hash,
      startedAt: at(start),
      ...(w.finished ? { completedAt: at(w.end) } : {}),
      complete: w.finished,
      events: w.events,
      chunkCount: 0,
      eventCount: w.events.length,
      receivedAt: at(kind === "in_progress" ? Math.min(now.getTime() - 60_000, w.end + 30_000) : w.end + (5 + Math.floor(rnd() * 120)) * 60_000),
      quarantined: false,
      provenance: "device",
    };
  };
  plan.forEach(({ child, kind, idx, june }, n) => {
    let start = june ? schoolTime(juneStart + Math.floor(rnd() * 18) * 86_400_000, rnd) : schoolTime(septStart + Math.floor((n / plan.length) * septSpan), rnd);
    if (kind === "in_progress") start = now.getTime() - (1 + Math.floor(rnd() * 3)) * 3_600_000;
    const code = kind === "test" ? `TST${String(n + 1).padStart(4, "0")}` : `${child.site}${String(1001 + n).padStart(4, "0")}`;
    const opts = {
      idx, child, start, code, rnd, templates,
      skipRate: kind === "incomplete" ? 0.08 : 0,
      ...(kind === "abandoned" ? { stopAfter: 8 + Math.floor(rnd() * 60) } : {}),
      ...(kind === "in_progress" ? { stopAfter: 5 + Math.floor(rnd() * 20) } : {}),
      tooFast: kind === "speeder",
      decline: kind === "declined",
    };
    out.push(sitting(opts, n, kind));
  });
  // Sittings under versions published later in MySelf Studio (./studio.mjs): new
  // children on the day each version was on the iPads, drawn from their own
  // random stream so the rest of the study is the same with or without them.
  later.forEach(({ manifest, day, count: k }, j) => {
    const more = prng(seed + 1 + j);
    const idx = indexRelease(manifest);
    for (let i = 0; i < k; i += 1) {
      const n = plan.length + i;
      const child = newChild(n, more);
      const start = schoolTime(Date.parse(day), more);
      out.push(sitting({ idx, child, start, code: `${child.site}${String(1001 + n).padStart(4, "0")}`, rnd: more, templates }, n, "complete"));
    }
  });
  for (const s of scenarios) {
    out.push({ ...s, deviceId: "inst_scenarios", study, chunkCount: 0, eventCount: s.events.length, receivedAt: s.completedAt, quarantined: false, provenance: "device" });
  }
  return { sittings: out.sort((a, b) => a.startedAt.localeCompare(b.startedAt)), releases: [readRelease("8.0.0"), readRelease("9.0.0")] };
}
