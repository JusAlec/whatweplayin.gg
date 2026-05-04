import type { User, Group, ScoringWeights } from '@wwp/auth-shared';

// Helper: snake_case row → camelCase typed object
function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: (row.email as string | null) ?? null,
    emailVerified: row.email_verified === 1,
    displayName: row.display_name as string,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToGroup(row: Record<string, unknown>): Group {
  return {
    id: row.id as string,
    displayName: row.display_name as string,
    creatorId: row.creator_id as string,
    scoringWeights: JSON.parse(row.scoring_weights as string) as ScoringWeights,
    customCompletionGoals: row.custom_completion_goals
      ? (JSON.parse(row.custom_completion_goals as string) as Record<string, string>)
      : null,
    createdAt: row.created_at as string,
    memberCount: row.member_count as number,
  };
}

class UsersTable {
  constructor(private db: D1Database) {}

  async insert(u: User): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO users (id, email, email_verified, display_name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(u.id, u.email, u.emailVerified ? 1 : 0, u.displayName, u.avatarUrl, u.createdAt, u.updatedAt)
      .run();
  }

  async getById(id: string): Promise<User | null> {
    const row = await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    return row ? rowToUser(row as Record<string, unknown>) : null;
  }

  async getByEmail(email: string): Promise<User | null> {
    const row = await this.db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    return row ? rowToUser(row as Record<string, unknown>) : null;
  }
}

class GroupsTable {
  constructor(private db: D1Database) {}

  async insert(g: Group): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO groups (id, display_name, creator_id, scoring_weights, custom_completion_goals, created_at, member_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        g.id,
        g.displayName,
        g.creatorId,
        JSON.stringify(g.scoringWeights),
        g.customCompletionGoals ? JSON.stringify(g.customCompletionGoals) : null,
        g.createdAt,
        g.memberCount,
      )
      .run();
  }

  async getById(id: string): Promise<Group | null> {
    const row = await this.db.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first();
    return row ? rowToGroup(row as Record<string, unknown>) : null;
  }
}

export class Db {
  users: UsersTable;
  groups: GroupsTable;

  constructor(d1: D1Database) {
    this.users = new UsersTable(d1);
    this.groups = new GroupsTable(d1);
  }
}
