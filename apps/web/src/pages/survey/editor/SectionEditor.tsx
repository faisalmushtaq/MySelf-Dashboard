import { useState } from "react";
import {
  definitionOf,
  questions as allQuestions,
  rewordable,
  scaleUsers,
  type Definition,
  type Edit,
  type Item,
  type NewQuestion,
  type Workspace,
} from "@myself-dashboard/core";
import { Icon } from "../../../components/Icon";
import { Committed } from "./Committed";
import { describeCondition, isSimple, REQUIRED_LABELS, TYPE_LABELS } from "./words";

/**
 * One section: its title and introduction, and every question in it, part by
 * part. The study's own parts can be reworded, extended and pruned; licensed
 * instruments show their wording but say why it cannot change here.
 */
export function SectionEditor({ ws, sectionKey, push }: { ws: Workspace; sectionKey: string; push: (e: Edit) => string | null }) {
  const section = ws.draft.sections.find((s) => s.key === sectionKey);
  if (!section) return <p className="hint">Choose a section on the left.</p>;
  if (section.components.every((c) => c.kind === "narrative")) {
    return <p className="hint">This is MyStory. Change or remove it on the MyStory tab.</p>;
  }
  return (
    <div className="section-editor">
      <div className="card">
        <h2>Section</h2>
        <Committed label="Title" value={section.title} onCommit={(text) => push({ op: "setSectionText", section: section.key, field: "title", text })} />
        <Committed label="Text introducing it (optional)" multiline value={section.transition ?? ""} onCommit={(text) => push({ op: "setSectionText", section: section.key, field: "transition", text })} />
        {section.displayIf ? <p className="hint">Shown only when {describeCondition(section.displayIf, ws)}.</p> : null}
      </div>
      {section.components.map((c, i) => {
        if (c.kind !== "instrument" && c.kind !== "module") return null;
        const def = definitionOf(ws, c.ref);
        if (!def) return null;
        return <PartEditor key={`${c.ref.instrument}-${i}`} ws={ws} def={def} push={push} shownIf={c.displayIf} />;
      })}
    </div>
  );
}

function PartEditor({ ws, def, push, shownIf }: { ws: Workspace; def: Definition; push: (e: Edit) => string | null; shownIf?: unknown }) {
  const editable = rewordable(def);
  const items = def.forms[0]?.items ?? [];
  const [adding, setAdding] = useState(false);
  return (
    <section className="card part" aria-labelledby={`part-${def.instrument}`}>
      <div className="card-head">
        <h2 id={`part-${def.instrument}`}>{def.name}</h2>
        {editable ? <span className="tag tag-good">the study's own</span> : <span className="tag tag-quiet"><Icon name="lock" size={12} /> licensed: wording fixed</span>}
      </div>
      {!editable ? <p className="hint">Its licence {def.licence.modifiable === "no" ? "does not allow changes to its wording or options" : "allows changes only with the licensor's permission"}. It can be left out of the survey from the outline, or kept as it is.</p> : null}
      {shownIf ? <p className="hint">Shown only when {describeCondition(shownIf, ws)}.</p> : null}
      <ol className="question-list">
        {items.map((item) => (
          <QuestionCard key={item.key} ws={ws} def={def} item={item} editable={editable} push={push} />
        ))}
      </ol>
      {editable ? (
        adding ? (
          <AddQuestion ws={ws} def={def} push={push} onDone={() => setAdding(false)} />
        ) : (
          <button type="button" className="btn btn-quiet" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Add a question to {def.name}
          </button>
        )
      ) : null}
    </section>
  );
}

function QuestionCard({ ws, def, item, editable, push }: { ws: Workspace; def: Definition; item: Item; editable: boolean; push: (e: Edit) => string | null }) {
  const key = `${def.instrument}.${item.key}`;
  const scale = item.scale ? ws.scales[item.scale] : undefined;
  const sharers = item.scale ? scaleUsers(ws, item.scale) : [];
  const scaleEditable = !!scale && sharers.every((u) => rewordable(u.definition));
  const [newOption, setNewOption] = useState("");
  const fail = (problem: string | null) => (problem ? window.alert(problem) : undefined);
  return (
    <li className="question">
      <div className="question-meta">
        <code>{key}</code> · {TYPE_LABELS[item.responseType] ?? item.responseType} · variable <code>{item.variable}</code>
        {item.identifying ? <span className="tag tag-warn">identifying</span> : null}
      </div>
      {editable && item.responseType !== "info" ? (
        <>
          <Committed label="Wording" multiline value={item.stem.text} onCommit={(text) => push({ op: "setQuestionText", question: key, field: "stem", text })} />
          <Committed label="Text under the question (optional)" multiline value={item.lede?.text ?? ""} onCommit={(text) => push({ op: "setQuestionText", question: key, field: "lede", text })} />
        </>
      ) : editable ? (
        <Committed label="Text" multiline rows={4} value={item.stem.text} onCommit={(text) => push({ op: "setQuestionText", question: key, field: "stem", text })} />
      ) : (
        <p className="question-text">{item.stem.text}</p>
      )}
      {item.responseType !== "info" ? (
        <div className="field-row">
          <label>
            Answering it
            <select
              value={item.required ?? "soft"}
              disabled={!editable}
              onChange={(e) => fail(push({ op: "setRequired", question: key, required: e.target.value as "hard" | "soft" | "optional" }))}
            >
              {Object.entries(REQUIRED_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {editable ? (
            <button type="button" className="btn btn-small btn-quiet" disabled={item.identifying} onClick={() => fail(push({ op: "removeQuestion", question: key }))}>
              <Icon name="trash" size={14} /> Remove the question
            </button>
          ) : null}
        </div>
      ) : null}
      {scale ? (
        <div className="options">
          <div className="hint">
            Options{sharers.length > 1 ? ` — the scale ${scale.key} is shared by ${sharers.length} questions; a change here changes all of them` : ""}
          </div>
          <ol>
            {scale.options.map((o) => (
              <li key={o.code}>
                {scaleEditable ? (
                  <Committed label={`Option ${o.code}`} value={o.label} onCommit={(label) => push({ op: "setOptionLabel", scale: scale.key, code: o.code, label })} />
                ) : (
                  <span>
                    <span className="hint">{o.code}</span> {o.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {scaleEditable ? (
            <div className="field-row">
              <label className="grow">
                Add an option
                <input type="text" value={newOption} onChange={(e) => setNewOption(e.target.value)} />
              </label>
              <button
                type="button"
                className="btn btn-small"
                disabled={!newOption.trim()}
                onClick={() => {
                  const problem = push({ op: "addOption", scale: scale.key, label: newOption });
                  if (problem) window.alert(problem);
                  else setNewOption("");
                }}
              >
                Add
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <ShowIf ws={ws} questionKey={key} item={item} editable={editable} push={push} />
    </li>
  );
}

function ShowIf({ ws, questionKey, item, editable, push }: { ws: Workspace; questionKey: string; item: Item; editable: boolean; push: (e: Edit) => string | null }) {
  const earlier = (() => {
    const all = allQuestions(ws);
    const at = all.findIndex((q) => `${q.definition.instrument}.${q.item.key}` === questionKey);
    return all.slice(0, Math.max(0, at)).filter((q) => q.item.scale && (q.item.responseType === "single_choice" || q.item.responseType === "multi_choice"));
  })();
  const simple = isSimple(item.displayIf) ? item.displayIf : null;
  const [target, setTarget] = useState(simple ? `${simple.target.item.instrument}.${simple.target.item.item}` : "");
  const [is, setIs] = useState<"selected" | "not_selected">(simple?.op ?? "selected");
  const [code, setCode] = useState<number | "">(simple?.code ?? "");
  if (!editable) return item.displayIf ? <p className="hint">Asked only when {describeCondition(item.displayIf, ws)}.</p> : null;
  if (item.displayIf && !simple) {
    return <p className="hint">Asked only when {describeCondition(item.displayIf, ws)}. (This condition is more complex than this page can edit.)</p>;
  }
  const targetItem = earlier.find((q) => `${q.definition.instrument}.${q.item.key}` === target)?.item;
  const options = targetItem?.scale ? ws.scales[targetItem.scale]?.options ?? [] : [];
  const apply = (next: { target: string; is: "selected" | "not_selected"; code: number | "" }) => {
    if (!next.target || next.code === "") return;
    const problem = push({ op: "setShowIf", question: questionKey, condition: { question: next.target, is: next.is, code: next.code } });
    if (problem) window.alert(problem);
  };
  return (
    <details className="show-if" open={!!item.displayIf}>
      <summary>{item.displayIf ? `Asked only when ${describeCondition(item.displayIf, ws)}` : "Asked of everyone who reaches it"}</summary>
      <div className="field-row">
        <label className="grow">
          Ask only when the answer to
          <select value={target} onChange={(e) => { setTarget(e.target.value); setCode(""); }}>
            <option value="">(choose an earlier question)</option>
            {earlier.map((q) => (
              <option key={`${q.definition.instrument}.${q.item.key}`} value={`${q.definition.instrument}.${q.item.key}`}>
                {q.item.stem.text.slice(0, 70)}
              </option>
            ))}
          </select>
        </label>
        <label>
          is
          <select value={is} onChange={(e) => { const v = e.target.value as "selected" | "not_selected"; setIs(v); apply({ target, is: v, code }); }}>
            <option value="selected">chosen</option>
            <option value="not_selected">not chosen</option>
          </select>
        </label>
        <label>
          option
          <select value={code} onChange={(e) => { const v = e.target.value === "" ? "" : Number(e.target.value); setCode(v); apply({ target, is, code: v }); }}>
            <option value="">(choose)</option>
            {options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {item.displayIf ? (
          <button type="button" className="btn btn-small btn-quiet" onClick={() => { const p = push({ op: "setShowIf", question: questionKey, condition: null }); if (p) window.alert(p); else { setTarget(""); setCode(""); } }}>
            Ask everyone
          </button>
        ) : null}
      </div>
    </details>
  );
}

function AddQuestion({ ws, def, push, onDone }: { ws: Workspace; def: Definition; push: (e: Edit) => string | null; onDone: () => void }) {
  const items = def.forms[0]?.items ?? [];
  const [q, setQ] = useState<NewQuestion>({ key: "", variable: "", type: "single_choice", text: "", options: ["", ""], required: "soft" });
  const [after, setAfter] = useState<string>(items.at(-1)?.key ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<NewQuestion>) => setQ((x) => ({ ...x, ...patch }));
  const choice = q.type === "single_choice" || q.type === "multi_choice";
  void ws;
  return (
    <form
      className="add-question"
      onSubmit={(e) => {
        e.preventDefault();
        const p = push({ op: "addQuestion", instrument: def.instrument, after: after || null, question: { ...q, ...(choice ? { options: (q.options ?? []).filter((o) => o.trim()) } : { options: undefined }) } });
        if (p) setProblem(p);
        else onDone();
      }}
    >
      <h3>New question in {def.name}</h3>
      <label>
        Wording
        <textarea required rows={2} value={q.text} onChange={(e) => set({ text: e.target.value })} />
      </label>
      <div className="field-row">
        <label>
          Answered as
          <select value={q.type} onChange={(e) => set({ type: e.target.value as NewQuestion["type"] })}>
            <option value="single_choice">One option</option>
            <option value="multi_choice">Several options</option>
            <option value="text_short">Short text</option>
            <option value="text_long">Long text</option>
            <option value="numeric">Number</option>
          </select>
        </label>
        <label>
          Answering it
          <select value={q.required} onChange={(e) => set({ required: e.target.value as NewQuestion["required"] })}>
            {Object.entries(REQUIRED_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          After
          <select value={after} onChange={(e) => setAfter(e.target.value)}>
            <option value="">(first in {def.name})</option>
            {items.map((i) => (
              <option key={i.key} value={i.key}>
                {i.stem.text.slice(0, 50)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {choice ? (
        <fieldset>
          <legend>Options, in the order shown</legend>
          {(q.options ?? []).map((o, i) => (
            <input key={i} type="text" aria-label={`Option ${i + 1}`} value={o} onChange={(e) => set({ options: (q.options ?? []).map((x, j) => (j === i ? e.target.value : x)) })} />
          ))}
          <button type="button" className="btn btn-small btn-quiet" onClick={() => set({ options: [...(q.options ?? []), ""] })}>
            Another option
          </button>
        </fieldset>
      ) : null}
      {q.type === "numeric" ? (
        <div className="field-row">
          <label>
            Smallest
            <input type="number" value={q.min ?? ""} onChange={(e) => set({ min: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </label>
          <label>
            Largest
            <input type="number" value={q.max ?? ""} onChange={(e) => set({ max: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </label>
        </div>
      ) : null}
      <div className="field-row">
        <label>
          Question key
          <input type="text" required pattern="[a-z][a-z0-9_]*" value={q.key} onChange={(e) => set({ key: e.target.value.toLowerCase() })} placeholder="own_tablet" />
        </label>
        <label>
          Variable name in exports
          <input type="text" required pattern="[a-z][a-z0-9_]{0,31}" value={q.variable} onChange={(e) => set({ variable: e.target.value.toLowerCase() })} placeholder="own_tablet" />
        </label>
      </div>
      {problem ? <p className="field-error" role="alert">{problem}</p> : null}
      <div className="button-row">
        <button type="submit" className="btn btn-primary">
          Add the question
        </button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
