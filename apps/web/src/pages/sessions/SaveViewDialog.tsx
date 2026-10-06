import { useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { firebase } from "../../lib/firebase";
import { studyPath } from "../../lib/study";
import { useFilters } from "../../app/filters";
import { useAnnounce } from "../../app/announcer";
import { Dialog } from "../../components/Dialog";
import { Notice } from "../../components/States";

/** Save the current filters, sort and columns as a named view (never the search text). */
export function SaveViewDialog({
  open,
  onClose,
  canShare,
  uid,
  email,
  state,
}: {
  open: boolean;
  onClose: () => void;
  canShare: boolean;
  uid: string;
  email: string;
  state: { path: string; params: URLSearchParams };
}) {
  const announce = useAnnounce();
  const { filters, sort } = useFilters();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shared, setShared] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try {
      const p = state.params;
      await addDoc(collection(firebase().db, studyPath("savedViews")), {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ownerUid: uid,
        ownerEmail: email.toLowerCase(),
        shared: canShare && shared,
        state: {
          path: state.path,
          filters: JSON.parse(JSON.stringify(filters)),
          sort,
          ...(p.get("cols") ? { columns: p.get("cols")!.split(",") } : {}),
          ...(p.get("dens") ? { density: p.get("dens") } : {}),
          ...(p.get("size") ? { pageSize: Number(p.get("size")) } : {}),
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      announce(`View “${name.trim()}” saved.`, "success");
      setName("");
      setDescription("");
      onClose();
    } catch {
      setErr("The view could not be saved. Check the name (1–80 characters) and try again.");
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Save this view"
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => void save()}>
            Save view
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p className="hint">Saves the filters, sort order, columns and page size. Search text is never saved.</p>
      {err ? <Notice tone="warn">{err}</Notice> : null}
      <label>
        Name
        <input type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Incomplete sessions, last 30 days" />
      </label>
      <label>
        Description (optional)
        <input type="text" maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={shared} disabled={!canShare} onChange={(e) => setShared(e.target.checked)} />
        Share with all dashboard members {canShare ? "" : "(researchers and administrators only)"}
      </label>
    </Dialog>
  );
}
