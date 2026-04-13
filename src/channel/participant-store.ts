import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { Participant, Permission, PrivacyPolicy } from '../types/channel.js';
import { DEFAULT_PERMISSIONS } from '../types/channel.js';

export class ParticipantStore {
  constructor(
    private db: Database.Database,
    private channelId: string
  ) {}

  add(opts: {
    userId: string;
    displayName: string;
    type: 'human' | 'agent';
    agentName?: string;
    permissions?: Permission[];
    privacyPolicy?: PrivacyPolicy;
    tokenHash: string;
  }): Participant {
    const now = new Date().toISOString();
    const permissions = opts.permissions ?? DEFAULT_PERMISSIONS;
    const participant: Participant = {
      id: nanoid(),
      channelId: this.channelId,
      userId: opts.userId,
      displayName: opts.displayName,
      type: opts.type,
      agentName: opts.agentName,
      permissions,
      privacyPolicy: opts.privacyPolicy,
      tokenHash: opts.tokenHash,
      joinedAt: now,
      lastSeenAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO participants (id, user_id, display_name, type, agent_name, permissions, privacy_policy, token_hash, joined_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        participant.id,
        participant.userId,
        participant.displayName,
        participant.type,
        participant.agentName ?? null,
        JSON.stringify(permissions),
        opts.privacyPolicy ? JSON.stringify(opts.privacyPolicy) : null,
        participant.tokenHash,
        participant.joinedAt,
        participant.lastSeenAt
      );
    return participant;
  }

  findByTokenHash(tokenHash: string): Participant | undefined {
    const row = this.db
      .prepare(`SELECT * FROM participants WHERE token_hash = ?`)
      .get(tokenHash) as RawRow | undefined;
    return row ? this.rowToParticipant(row) : undefined;
  }

  list(): Participant[] {
    const rows = this.db
      .prepare(`SELECT * FROM participants ORDER BY joined_at`)
      .all() as RawRow[];
    return rows.map((r) => this.rowToParticipant(r));
  }

  remove(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM participants WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  updateLastSeen(id: string): void {
    this.db
      .prepare(`UPDATE participants SET last_seen_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  }

  updatePermissions(id: string, permissions: Permission[]): boolean {
    const result = this.db
      .prepare(`UPDATE participants SET permissions = ? WHERE id = ?`)
      .run(JSON.stringify(permissions), id);
    return result.changes > 0;
  }

  updatePrivacyPolicy(id: string, policy: PrivacyPolicy | null): boolean {
    const result = this.db
      .prepare(`UPDATE participants SET privacy_policy = ? WHERE id = ?`)
      .run(policy ? JSON.stringify(policy) : null, id);
    return result.changes > 0;
  }

  getById(id: string): Participant | undefined {
    const row = this.db
      .prepare(`SELECT * FROM participants WHERE id = ?`)
      .get(id) as RawRow | undefined;
    return row ? this.rowToParticipant(row) : undefined;
  }

  private rowToParticipant(r: RawRow): Participant {
    return {
      id: r.id,
      channelId: this.channelId,
      userId: r.user_id,
      displayName: r.display_name,
      type: r.type as 'human' | 'agent',
      agentName: r.agent_name ?? undefined,
      permissions: r.permissions ? JSON.parse(r.permissions) : DEFAULT_PERMISSIONS,
      privacyPolicy: r.privacy_policy ? JSON.parse(r.privacy_policy) : undefined,
      tokenHash: r.token_hash,
      joinedAt: r.joined_at,
      lastSeenAt: r.last_seen_at,
    };
  }
}

type RawRow = {
  id: string;
  user_id: string;
  display_name: string;
  type: string;
  agent_name: string | null;
  permissions: string | null;
  privacy_policy: string | null;
  token_hash: string;
  joined_at: string;
  last_seen_at: string;
};
