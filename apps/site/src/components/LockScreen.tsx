import { useState } from 'react';
import { writeAuth } from '../lib/auth.js';
import { kv } from '../lib/kv-client.js';

interface Props {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: Props) {
  const [groupId, setGroupId] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const ok = await kv.validate(groupId, secret);
    setLoading(false);
    if (!ok) {
      setError('Invalid group or secret');
      return;
    }
    writeAuth({ groupId, secret });
    onUnlock();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 mt-12">
      <h2 className="text-xl font-semibold">Enter your group code</h2>
      <input
        className="bg-panel border border-border rounded px-3 py-2"
        placeholder="Group ID"
        value={groupId}
        onChange={(e) => setGroupId(e.target.value)}
        required
      />
      <input
        className="bg-panel border border-border rounded px-3 py-2"
        placeholder="Group Secret"
        type="password"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        required
      />
      {error && <div className="text-danger text-sm">{error}</div>}
      <button
        type="submit"
        disabled={loading}
        className="bg-accent text-bg font-semibold rounded py-2 disabled:opacity-50"
      >
        {loading ? 'Checking...' : 'Unlock'}
      </button>
    </form>
  );
}
