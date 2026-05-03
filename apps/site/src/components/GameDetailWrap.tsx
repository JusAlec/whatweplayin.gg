import { useEffect, useState } from 'react';
import GameDetail from './GameDetail.js';
import { readActivePerson } from '../lib/auth.js';

export default function GameDetailWrap({ gameId }: { gameId: string }) {
  const [personId, setPersonId] = useState<string | null>(null);
  useEffect(() => { setPersonId(readActivePerson()); }, []);
  return <GameDetail gameId={gameId} personId={personId} />;
}
