#!/usr/bin/env tsx
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const args = process.argv.slice(2);
const flagIdx = args.indexOf('--id');
const nameIdx = args.indexOf('--name');
const peopleIdx = args.indexOf('--people');

if (flagIdx === -1 || nameIdx === -1 || peopleIdx === -1) {
  console.error('Usage: tsx bootstrap-group.ts --id <gid> --name <displayName> --people alec,mike,sarah,jordan,casey');
  process.exit(1);
}

const groupId = args[flagIdx + 1]!;
const displayName = args[nameIdx + 1]!;
const peopleNames = args[peopleIdx + 1]!.split(',').map((s) => s.trim());

const dir = resolve(process.cwd(), 'data', 'groups', groupId);
if (existsSync(dir)) {
  console.error(`group ${groupId} already exists at ${dir}`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

const secret = randomBytes(16).toString('hex');
const secretHash = createHash('sha256').update(secret).digest('hex');

const NEUTRAL_PREFS = { combat: 3, grind: 3, buildingDepth: 3, commitmentLevel: 3, pvpFocus: 3, sessionLength: 3 };
const people = peopleNames.map((name) => ({
  id: name.toLowerCase(),
  displayName: name,
  stablePrefs: NEUTRAL_PREFS,
}));

const group = {
  id: groupId,
  displayName,
  scoringWeights: { preferenceMatch: 0.4, groupFit: 0.25, sessionFit: 0.2, novelty: 0.15 },
  secretHash,
};

writeFileSync(resolve(dir, 'people.json'), JSON.stringify(people, null, 2));
writeFileSync(resolve(dir, 'group.json'), JSON.stringify(group, null, 2));

console.log(`Group "${groupId}" created at ${dir}`);
console.log(`\nGroup secret (write this in Cloudflare KV under group:${groupId}:secret):\n  ${secret}\n`);
console.log(`Send members the URL: https://your-site.example/#g=${groupId}&s=${secret}`);
