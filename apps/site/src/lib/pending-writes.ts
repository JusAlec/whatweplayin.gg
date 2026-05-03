const KEY = 'gno:pendingWrites';
const MAX = 100;

export interface PendingWrite {
  method: 'PUT' | 'POST';
  path: string;
  body: unknown;
  queuedAt: string;
}

export function enqueue(write: Omit<PendingWrite, 'queuedAt'>): void {
  const all = readAll();
  all.push({ ...write, queuedAt: new Date().toISOString() });
  while (all.length > MAX) all.shift();
  window.localStorage.setItem(KEY, JSON.stringify(all));
}

export function readAll(): PendingWrite[] {
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingWrite[];
  } catch {
    return [];
  }
}

export function clear(): void {
  window.localStorage.removeItem(KEY);
}

export async function flush(send: (w: PendingWrite) => Promise<boolean>): Promise<number> {
  const all = readAll();
  const remaining: PendingWrite[] = [];
  let sent = 0;
  for (const w of all) {
    const ok = await send(w).catch(() => false);
    if (ok) sent++;
    else remaining.push(w);
  }
  window.localStorage.setItem(KEY, JSON.stringify(remaining));
  return sent;
}
