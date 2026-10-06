import { downloadUrl, firebase } from "./firebase";
import { currentStudy } from "./study";

/**
 * Fetch an export through the authenticated endpoint and hand it to the browser
 * as a file. The file never has a public URL: the request carries the current ID
 * token and the server checks it, the caller's role, their access to the study
 * the export was made in (the one on screen) and the export's owner.
 */
export async function downloadExport(jobId: string, fileName: string): Promise<void> {
  const user = firebase().auth.currentUser;
  if (!user) throw new Error("Sign in again to download this export.");
  const token = await user.getIdToken();
  const study = currentStudy();
  if (!study) throw new Error("Choose a study first.");
  const res = await fetch(downloadUrl(jobId, study), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", referrerPolicy: "no-referrer" });
  if (!res.ok) {
    let message = `The download was refused (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  try {
    const seen = JSON.parse(localStorage.getItem("exports.downloaded") ?? "[]") as string[];
    localStorage.setItem("exports.downloaded", JSON.stringify([...seen.slice(-50), jobId]));
  } catch {
    /* ignore */
  }
}
