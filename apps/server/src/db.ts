import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE families (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    avatar TEXT,
    mode TEXT NOT NULL CHECK (mode IN ('supervised', 'self')),
    timezone TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    policy_version INTEGER NOT NULL DEFAULT 1,
    overrides_json TEXT NOT NULL DEFAULT '[]',
    unlock_secret TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    agent_version TEXT,
    status_json TEXT NOT NULL DEFAULT '{}',
    policy_version INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER,
    offline_alerted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE pairing_codes (
    code TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE usage_rules (
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    day TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    used_ms INTEGER NOT NULL,
    opens INTEGER NOT NULL,
    interval_used_ms INTEGER NOT NULL DEFAULT 0,
    break_until INTEGER,
    PRIMARY KEY (device_id, day, rule_id)
  );
  CREATE INDEX usage_rules_profile_day ON usage_rules(profile_id, day);
  CREATE TABLE usage_items (
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    day TEXT NOT NULL,
    item_key TEXT NOT NULL,
    label TEXT NOT NULL,
    used_ms INTEGER NOT NULL,
    opens INTEGER NOT NULL,
    blocked_attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (device_id, day, item_key)
  );
  CREATE INDEX usage_items_profile_day ON usage_items(profile_id, day);
  CREATE TABLE requests (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('unlock', 'more_time', 'new_app')),
    rule_id TEXT,
    target_json TEXT,
    label TEXT NOT NULL,
    reason TEXT,
    minutes_requested INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
    minutes_granted INTEGER,
    decided_by TEXT,
    response_note TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER
  );
  CREATE INDEX requests_profile_status ON requests(profile_id, status);
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    message TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX events_profile_created ON events(profile_id, created_at);
  CREATE TABLE pending_changes (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('policy', 'override')),
    payload_json TEXT NOT NULL,
    apply_at INTEGER NOT NULL,
    created_by TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    keys_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE accounts ADD COLUMN telegram_chat_id TEXT;
  ALTER TABLE accounts ADD COLUMN email_alerts TEXT NOT NULL DEFAULT 'critical' CHECK (email_alerts IN ('all', 'critical', 'off'));
  CREATE TABLE telegram_links (
    code TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE devices ADD COLUMN push_token TEXT;
  `,
];

export type Row = Record<string, SQLInputValue>;

export class Db {
  readonly sql: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate(): void {
    this.sql.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.sql.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    let version = row?.version ?? 0;
    if (!row) this.sql.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    while (version < MIGRATIONS.length) {
      this.transaction(() => {
        this.sql.exec(MIGRATIONS[version]!);
        this.sql.prepare('UPDATE schema_version SET version = ?').run(version + 1);
      });
      version++;
    }
  }

  get<T>(query: string, ...params: SQLInputValue[]): T | undefined {
    return this.sql.prepare(query).get(...params) as T | undefined;
  }

  all<T>(query: string, ...params: SQLInputValue[]): T[] {
    return this.sql.prepare(query).all(...params) as T[];
  }

  run(query: string, ...params: SQLInputValue[]): { changes: number } {
    const r = this.sql.prepare(query).run(...params);
    return { changes: Number(r.changes) };
  }

  transaction<T>(fn: () => T): T {
    this.sql.exec('BEGIN');
    try {
      const result = fn();
      this.sql.exec('COMMIT');
      return result;
    } catch (err) {
      this.sql.exec('ROLLBACK');
      throw err;
    }
  }

  kvGet(key: string): string | undefined {
    return this.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)?.value;
  }

  kvSet(key: string, value: string): void {
    this.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  close(): void {
    this.sql.close();
  }
}
