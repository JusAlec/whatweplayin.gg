import type { Person, GroupSettings } from '@gno/recommender';
import { readAuth } from './auth.js';

interface GroupBundle {
  people: Person[];
  group: GroupSettings;
}

export async function loadGroupBundle(): Promise<GroupBundle> {
  const auth = readAuth();
  if (!auth) throw new Error('not authenticated');
  const [people, group] = await Promise.all([
    fetch(`/data/groups/${auth.groupId}/people.json`).then((r) => r.json() as Promise<Person[]>),
    fetch(`/data/groups/${auth.groupId}/group.json`).then(
      (r) => r.json() as Promise<GroupSettings>,
    ),
  ]);
  return { people, group };
}
