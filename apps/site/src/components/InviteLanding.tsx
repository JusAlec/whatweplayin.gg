import { useEffect, useState } from 'react';
import { api, AuthError } from '../lib/api-client.js';
import { fetchMe } from '../lib/auth.js';

interface Props {
  code: string;
}

interface InvitePreview {
  groupId: string;
  groupName: string;
  memberCount: number;
  expiresAt: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'preview'; preview: InvitePreview; signedIn: boolean }
  | { kind: 'error'; message: string };

export default function InviteLanding({ code }: Props) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [preview, me] = await Promise.all([
          api.get<InvitePreview>(`/api/invites/${encodeURIComponent(code)}`),
          fetchMe(),
        ]);
        if (cancelled) return;
        setState({ kind: 'preview', preview, signedIn: me !== null });
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function accept() {
    setBusy(true);
    try {
      const res = await api.post<{ groupId: string }>('/api/invites/accept', { code });
      window.location.href = `/groups/${res.groupId}`;
    } catch (e) {
      if (e instanceof AuthError) {
        // Stash invite code so post-signin we can resume.
        sessionStorage.setItem('wwp:pendingInvite', code);
        window.location.href = '/signin';
        return;
      }
      setState({ kind: 'error', message: (e as Error).message });
      setBusy(false);
    }
  }

  if (state.kind === 'loading') {
    return <p className="text-muted text-sm">Loading invite…</p>;
  }

  if (state.kind === 'error') {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Invite unavailable</h1>
        <p className="text-sm text-danger">{state.message}</p>
        <a href="/" className="text-sm text-muted hover:text-text">
          ← Home
        </a>
      </div>
    );
  }

  const { preview, signedIn } = state;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted">You're invited to</p>
        <h1 className="text-2xl font-semibold">{preview.groupName}</h1>
        <p className="text-xs text-muted">
          {preview.memberCount} member{preview.memberCount === 1 ? '' : 's'} · Expires{' '}
          {new Date(preview.expiresAt).toLocaleString()}
        </p>
      </header>

      {signedIn ? (
        <button
          onClick={accept}
          disabled={busy}
          className="w-full rounded bg-accent px-4 py-3 font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Joining…' : 'Accept invite'}
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">Sign in to accept this invite.</p>
          <button
            onClick={() => {
              sessionStorage.setItem('wwp:pendingInvite', code);
              window.location.href = '/signin';
            }}
            className="w-full rounded bg-accent px-4 py-3 font-medium text-white"
          >
            Sign in to accept
          </button>
        </div>
      )}
    </div>
  );
}
