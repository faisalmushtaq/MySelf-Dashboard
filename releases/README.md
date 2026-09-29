# Survey release manifests (snapshot)

The published MySelf survey versions, copied from `faisalmushtaq/MySelf`
`releases/` (r1.0.0–r7.1.0 at commit `ee554ac`, r7.2.0 at `e28e383`, r7.3.0 at `20e0e9d`; the unhashed
preview manifest is left out). They are survey definitions — questions, options, display rules — and
contain no participant data.

They are here so the setup workflow can register them without access to the
private survey repository. `scripts/sync-releases.mjs --from releases` recomputes
each file's content hash and refuses any file that does not match, so a copy can
never be registered under the wrong version.

New survey versions: copy the new `*.manifest.json` here and run the sync script,
or upload it in the dashboard under **Settings → Survey versions**.

Until an administrator sets **Settings → Active survey version**, the dashboard
treats the newest registered version as the one the survey is serving. So
register a new version once the survey is serving it, or set the active version
by hand if you register it earlier.
