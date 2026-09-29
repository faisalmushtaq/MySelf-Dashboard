import { lazy, Suspense, useState, type FormEvent } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./app/auth";
import { AnnouncerProvider } from "./app/announcer";
import { StudyDataProvider } from "./app/data";
import { Shell } from "./app/Shell";
import { Icon } from "./components/Icon";
import { Loading } from "./components/States";
import { USE_EMULATORS } from "./lib/firebase";

const Overview = lazy(() => import("./pages/Overview"));
const Sessions = lazy(() => import("./pages/Sessions"));
const SessionPage = lazy(() => import("./pages/SessionPage"));
const Completeness = lazy(() => import("./pages/Completeness"));
const Questions = lazy(() => import("./pages/Questions"));
const Reports = lazy(() => import("./pages/Reports"));
const Figures = lazy(() => import("./pages/Figures"));
const Participants = lazy(() => import("./pages/Participants"));
const SavedViews = lazy(() => import("./pages/SavedViews"));
const Audit = lazy(() => import("./pages/Audit"));
const Settings = lazy(() => import("./pages/Settings"));
const HelpPage = lazy(() => import("./pages/Help"));

export function App() {
  return (
    <AnnouncerProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </AnnouncerProvider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="gate" id="main">
      <div className="gate-card">
        <div className="brand gate-brand">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>
            <strong>MySelf</strong>
            <span className="brand-sub">Research Dashboard</span>
          </span>
        </div>
        {children}
      </div>
    </main>
  );
}

function EmulatorSignIn() {
  const { signInEmulator } = useAuth();
  const [email, setEmail] = useState("brainpopresearch@gmail.com");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void signInEmulator(email);
  };
  return (
    <form className="emulator-signin" onSubmit={submit} aria-label="Emulator sign-in">
      <p className="hint">
        <Icon name="beaker" size={14} /> Local emulator build: sign in as any Google identity. This form does not exist in production builds.
      </p>
      <label>
        Emulated Google account
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <button type="submit" className="btn">
        Sign in (emulator)
      </button>
    </form>
  );
}

function Gate() {
  const { state, signIn, signOut, retry } = useAuth();
  switch (state.kind) {
    case "unconfigured":
      return (
        <Centered>
          <h1>Not configured</h1>
          <p>This build of the dashboard has no Firebase project configured. Set VITE_FIREBASE_CONFIG at build time (see docs/06-handover.md).</p>
        </Centered>
      );
    case "loading":
      return (
        <Centered>
          <Loading label="Checking your access" />
        </Centered>
      );
    case "signed_out":
      return (
        <Centered>
          <h1>Sign in</h1>
          <p>This dashboard holds confidential research data. It is for authorised BrainPOP Research accounts only.</p>
          {state.notice ? (
            <p className="notice notice-info" role="status">
              {state.notice}
            </p>
          ) : null}
          <button type="button" className="btn btn-primary btn-large" onClick={() => void signIn()}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Sign in with Google
          </button>
          {USE_EMULATORS ? <EmulatorSignIn /> : null}
          <p className="hint">Sign-in lasts for this browser tab and ends after 30 minutes without activity.</p>
        </Centered>
      );
    case "denied":
      return (
        <Centered>
          <h1>
            <Icon name="lock" /> Access not granted
          </h1>
          <p>{state.reason}</p>
          <p className="hint">Signed in as {state.email ?? "an unknown account"}. Nothing from the study has been shown to this account.</p>
          <div className="button-row">
            <button type="button" className="btn" onClick={() => void signOut()}>
              Sign out and use another account
            </button>
            <button type="button" className="btn btn-quiet" onClick={retry}>
              Check again
            </button>
          </div>
        </Centered>
      );
    case "error":
      return (
        <Centered>
          <h1>Could not check your access</h1>
          <p>{state.message}</p>
          <div className="button-row">
            <button type="button" className="btn" onClick={retry}>
              <Icon name="refresh" size={16} /> Try again
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </Centered>
      );
    case "authorised":
      return (
        <StudyDataProvider>
          <BrowserRouter>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route element={<Shell />}>
                  <Route path="/" element={<Navigate to="/overview" replace />} />
                  <Route path="/overview" element={<Overview />} />
                  <Route path="/sessions" element={<Sessions />} />
                  <Route path="/sessions/:sessionId" element={<SessionPage />} />
                  <Route path="/completeness" element={<Completeness />} />
                  <Route path="/questions" element={<Questions />} />
                  <Route path="/figures" element={<Figures />} />
                  <Route path="/participants" element={<Participants />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/views" element={<SavedViews />} />
                  <Route path="/audit" element={<Audit />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/help" element={<HelpPage />} />
                  <Route
                    path="*"
                    element={
                      <div className="page">
                        <h1>Page not found</h1>
                        <p>
                          That address is not part of the dashboard. <a href="/overview">Go to the overview</a>.
                        </p>
                      </div>
                    }
                  />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </StudyDataProvider>
      );
  }
}
