// Inline SVG icons (Lucide style — stroke-based, currentColor).
// Add new icons here rather than reaching for an icon library.

interface IconProps {
  size?: number;
  className?: string;
}

const baseProps = (size: number, className?: string) => ({
  xmlns: 'http://www.w3.org/2000/svg',
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
});

export function SettingsIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function SignOutIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export function PlusIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function LogInIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" x2="3" y1="12" y2="12" />
    </svg>
  );
}

export function CloseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function ThumbUpIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l4-7c.27-.5.85-.96 1.5-.5C13.69 3.46 14 5 14 6.21" />
    </svg>
  );
}

export function ThumbDownIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17v12l-4 7c-.27.5-.85.96-1.5.5-1.19-.84-1.5-2.38-1.5-3.5" />
    </svg>
  );
}

export function RefreshIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}
