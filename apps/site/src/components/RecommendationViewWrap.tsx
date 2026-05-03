import { useEffect, useState } from 'react';
import RecommendationView from './RecommendationView.js';

export default function RecommendationViewWrap() {
  const [params, setParams] = useState<{ attendees: string[]; timeMins: number } | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const attendees = (sp.get('attendees') ?? '').split(',').filter(Boolean);
    const time = Number(sp.get('time') ?? 120);
    setParams({ attendees, timeMins: time });
  }, []);
  if (!params) return <p className="text-muted">Loading...</p>;
  return <RecommendationView {...params} />;
}
