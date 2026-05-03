const TABS = [
  { id: 'tonight', label: 'Tonight', href: '/' },
  { id: 'library', label: 'Library', href: '/library' },
  { id: 'people', label: 'People', href: '/people' },
  { id: 'log', label: 'Log', href: '/log' },
];

export default function BottomNav({ active }: { active: string }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-panel border-t border-border">
      <div className="mx-auto max-w-md grid grid-cols-4">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={t.href}
            className={`text-center py-3 text-sm ${
              active === t.id ? 'text-accent font-semibold' : 'text-muted'
            }`}
          >
            {t.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
