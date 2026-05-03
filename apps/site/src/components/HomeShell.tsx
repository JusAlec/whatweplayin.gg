import { useEffect, useState } from 'react';
import { readAuth } from '../lib/auth.js';
import LockScreen from './LockScreen.js';
import HomeContent from './HomeContent.js';
import { kv } from '../lib/kv-client.js';

export default function HomeShell() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    setAuthed(readAuth() !== null);
    if (typeof window === 'undefined') return;
    const onOnline = () => { void kv.flushPending(); };
    window.addEventListener('online', onOnline);
    void kv.flushPending();
    return () => window.removeEventListener('online', onOnline);
  }, []);

  if (authed === null) return <div className="text-muted">Loading...</div>;
  if (!authed) return <LockScreen onUnlock={() => setAuthed(true)} />;
  return <HomeContent />;
}
