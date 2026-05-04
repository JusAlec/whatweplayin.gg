import { useEffect, useState } from 'react';
import { fetchMe } from '../lib/auth.js';

export default function HomeRedirect() {
  const [message, setMessage] = useState('Loading…');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchMe();
        if (cancelled) return;
        if (me) {
          window.location.href = '/who';
        } else {
          window.location.href = '/signin';
        }
      } catch (e) {
        if (cancelled) return;
        setMessage(`Error: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <div className="text-muted">{message}</div>;
}
