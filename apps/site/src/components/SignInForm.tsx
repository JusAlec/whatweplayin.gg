import { useState } from 'react';
import { api } from '../lib/api-client.js';

const WORKER_URL = (import.meta.env.PUBLIC_WORKER_URL as string) ?? 'http://localhost:8787';

export default function SignInForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function submitMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErrorMsg('');
    try {
      await api.post('/api/auth/magic/request', { email });
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  if (status === 'sent') {
    return (
      <div className="mt-12 text-center">
        <h2 className="mb-2 text-xl font-semibold">Check your email</h2>
        <p className="text-muted">
          We sent a sign-in link to <strong>{email}</strong>.
        </p>
        <p className="mt-4 text-sm text-muted">It expires in 15 minutes.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-12 flex max-w-sm flex-col gap-6">
      <h1 className="text-center text-2xl font-semibold">Sign in to WhatWePlayin</h1>

      <a
        href={`${WORKER_URL}/api/auth/login/steam`}
        className="rounded bg-accent py-3 text-center font-semibold text-white"
      >
        Sign in with Steam
      </a>

      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border"></div>
        <span className="text-xs uppercase text-muted">or</span>
        <div className="h-px flex-1 bg-border"></div>
      </div>

      <form onSubmit={submitMagicLink} className="flex flex-col gap-3">
        <input
          type="email"
          required
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-border bg-panel px-3 py-2"
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="rounded border border-border bg-panel py-2 font-semibold text-text disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending…' : 'Email me a link'}
        </button>
      </form>

      {errorMsg && <p className="text-center text-sm text-danger">{errorMsg}</p>}
    </div>
  );
}
