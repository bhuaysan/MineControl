import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { ApiRequestError } from "../lib/api.js";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password, needCode ? code : undefined);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "2fa_required") {
        setNeedCode(true); // Passwort ok → jetzt Code abfragen.
      } else if (err instanceof ApiRequestError && err.code === "2fa_invalid") {
        setError("Bestätigungscode ungültig");
      } else {
        setNeedCode(false);
        setError(
          err instanceof ApiRequestError ? err.message : "Anmeldung fehlgeschlagen",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-xl"
      >
        <div className="mb-6 flex items-center gap-2">
          <span className="text-2xl">⛏️</span>
          <h1 className="text-xl font-bold">MineControl</h1>
        </div>

        <label className="mb-1 block text-sm text-neutral-400" htmlFor="username">
          Benutzername
        </label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          className="mb-4 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-status-online"
        />

        <label className="mb-1 block text-sm text-neutral-400" htmlFor="password">
          Passwort
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="mb-4 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-status-online"
        />

        {needCode && (
          <>
            <label className="mb-1 block text-sm text-neutral-400" htmlFor="code">
              Bestätigungscode (2FA)
            </label>
            <input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              placeholder="000000"
              className="mb-4 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono tracking-widest outline-none focus:border-status-online"
            />
          </>
        )}

        {error && <p className="mb-4 text-sm text-status-error">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-status-online py-2 font-medium text-neutral-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Anmelden…" : needCode ? "Bestätigen" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
