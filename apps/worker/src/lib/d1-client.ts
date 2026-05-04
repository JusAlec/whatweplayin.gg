import type {
  User,
  Group,
  ScoringWeights,
  Session,
  GroupMember,
  GroupInvite,
  StablePrefs,
} from '@wwp/auth-shared';

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

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    expiresAt: row.expires_at as string,
    createdAt: row.created_at as string,
  };
}

function rowToGroupMember(row: Record<string, unknown>): GroupMember {
  return {
    groupId: row.group_id as string,
    userId: row.user_id as string,
    role: row.role as 'creator' | 'member',
    joinedAt: row.joined_at as string,
    weight: row.weight as number,
    stablePrefs: row.stable_prefs ? (JSON.parse(row.stable_prefs as string) as StablePrefs) : null,
  };
}

function rowToInvite(row: Record<string, unknown>): GroupInvite {
  return {
    code: row.code as string,
    groupId: row.group_id as string,
    createdBy: row.created_by as string,
    expiresAt: row.expires_at as string,
    maxUses: row.max_uses as number,
    useCount: row.use_count as number,
    createdAt: row.created_at as string,
  };
}

class UsersTable {
  constructor(private db: D1Database) {}

  async insert(u: User): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO users (id, email, email_verified, display_name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        u.id,
        u.email,
        u.emailVerified ? 1 : 0,
        u.displayName,
        u.avatarUrl,
        u.createdAt,
        u.updatedAt,
      )
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

class SessionsTable {
  constructor(private db: D1Database) {}

  async insert(s: Session): Promise<void> {
    await this.db
      .prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(s.id, s.userId, s.expiresAt, s.createdAt)
      .run();
  }

  async getById(id: string): Promise<Session | null> {
    const row = await this.db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first();
    return row ? rowToSession(row as Record<string, unknown>) : null;
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  }
}

class GroupMembersTable {
  constructor(private db: D1Database) {}

  async insert(m: GroupMember): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO group_members (group_id, user_id, role, joined_at, weight, stable_prefs) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        m.groupId,
        m.userId,
        m.role,
        m.joinedAt,
        m.weight,
        m.stablePrefs ? JSON.stringify(m.stablePrefs) : null,
      )
      .run();
  }

  async listByGroup(groupId: string): Promise<GroupMember[]> {
    const result = await this.db
      .prepare('SELECT * FROM group_members WHERE group_id = ? ORDER BY joined_at ASC')
      .bind(groupId)
      .all();
    return (result.results as Record<string, unknown>[]).map(rowToGroupMember);
  }
}

class GroupInvitesTable {
  constructor(private db: D1Database) {}

  async insert(i: GroupInvite): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO group_invites (code, group_id, created_by, expires_at, max_uses, use_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(i.code, i.groupId, i.createdBy, i.expiresAt, i.maxUses, i.useCount, i.createdAt)
      .run();
  }

  async getByCode(code: string): Promise<GroupInvite | null> {
    const row = await this.db
      .prepare('SELECT * FROM group_invites WHERE code = ?')
      .bind(code)
      .first();
    return row ? rowToInvite(row as Record<string, unknown>) : null;
  }

  async incrementUseCount(code: string): Promise<void> {
    await this.db
      .prepare('UPDATE group_invites SET use_count = use_count + 1 WHERE code = ?')
      .bind(code)
      .run();
  }
}

export class Db {
  users: UsersTable;
  groups: GroupsTable;
  sessions: SessionsTable;
  groupMembers: GroupMembersTable;
  groupInvites: GroupInvitesTable;

  constructor(d1: D1Database) {
    this.users = new UsersTable(d1);
    this.groups = new GroupsTable(d1);
    this.sessions = new SessionsTable(d1);
    this.groupMembers = new GroupMembersTable(d1);
    this.groupInvites = new GroupInvitesTable(d1);
  }
}
