/**
 * User store + demo-user seeding.
 *
 * Passwords are NEVER stored in plaintext: the demo passwords below are hashed
 * with scrypt at seed time and only the salted hash is written to the database.
 * These are documented demo credentials intended for evaluation.
 */
import { db, now } from '../db.js';
import { hashPassword } from './passwords.js';

export type Role = 'MISSION_DIRECTOR' | 'MISSION_ANALYST' | 'SYSTEM_ADMIN';

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  display_name: string;
  created_at: string;
}

/** Public shape returned by the API — never includes the password hash. */
export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  display_name: string;
}

const DEMO_USERS: { id: string; username: string; password: string; role: Role; display_name: string }[] = [
  { id: 'usr_director', username: 'director', password: 'Orion@123', role: 'MISSION_DIRECTOR', display_name: 'Mission Director' },
  { id: 'usr_analyst', username: 'analyst', password: 'Orion@123', role: 'MISSION_ANALYST', display_name: 'Mission Analyst' },
  { id: 'usr_admin', username: 'admin', password: 'Orion@123', role: 'SYSTEM_ADMIN', display_name: 'System Administrator' },
];

export function seedUsers(): void {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (count > 0) return;
  const insert = db.prepare(
    `INSERT INTO users (id, username, password_hash, role, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const u of DEMO_USERS) {
    insert.run(u.id, u.username, hashPassword(u.password), u.role, u.display_name, now());
  }
}

export function findByUsername(username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
}

export function findById(id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function toPublic(u: UserRow): PublicUser {
  return { id: u.id, username: u.username, role: u.role, display_name: u.display_name };
}
