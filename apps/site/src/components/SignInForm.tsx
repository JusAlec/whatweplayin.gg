import { useState } from 'react';

export default function SignInForm() {
  const workerUrl = (import.meta.env.PUBLIC_WORKER_URL as string) ?? 'http://localhost:8787';
  const [busy, setBusy] = useState(false);

  function startSteam() {
    setBusy(true);
    window.location.href = `${workerUrl}/api/auth/steam/start`;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-muted text-sm">Sign in with Steam to find games to play together.</p>
      <button
        onClick={startSteam}
        disabled={busy}
        className="w-full rounded bg-accent text-white px-4 py-3 font-medium disabled:opacity-60"
      >
        {busy ? 'Redirecting…' : 'Sign in with Steam'}
      </button>
    </div>
  );
}
