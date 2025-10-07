import { getClientIp, getUserAgent } from "./requestMeta";

const SESSION_KEY_PREFIX = "session:";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOUCH_INTERVAL_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_ACTIVE_SESSIONS = 2;

export type SessionMeta = {
  ip?: string;
  ua?: string;
};

export type StoredSession = {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  ip?: string;
  ua?: string;
};

export const SESSION_COOKIE_NAME = "sid";
export const SESSION_COOKIE_TTL_SEC = 60 * 60 * 24 * 30;

function sessionKey(email: string) {
  return SESSION_KEY_PREFIX + email.toLowerCase();
}

function parseNumber(input: any, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

async function readSessions(env: any, email: string): Promise<StoredSession[]> {
  try {
    const raw = await env.DATA.get(sessionKey(email));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s: any) => typeof s?.id === "string" && s.id);
  } catch {
    return [];
  }
}

async function writeSessions(env: any, email: string, sessions: StoredSession[]): Promise<void> {
  if (!sessions.length) {
    await env.DATA.delete(sessionKey(email));
    return;
  }
  await env.DATA.put(sessionKey(email), JSON.stringify(sessions));
}

function sanitizeSessions(list: StoredSession[]): StoredSession[] {
  const now = Date.now();
  return list
    .filter((s) => now - s.createdAt <= SESSION_TTL_MS)
    .map((s) => ({ ...s }));
}

function getMaxSessions(env: any): number {
  return parseNumber(env?.MAX_ACTIVE_SESSIONS, DEFAULT_MAX_ACTIVE_SESSIONS);
}

export function buildSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_COOKIE_TTL_SEC}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function registerSession(env: any, req: Request, email: string, sessionId: string): Promise<void> {
  const meta: SessionMeta = {};
  const ip = getClientIp(req);
  if (ip) meta.ip = ip;
  const ua = getUserAgent(req);
  if (ua) meta.ua = ua;
  const now = Date.now();
  const current = sanitizeSessions(await readSessions(env, email)).filter((s) => s.id !== sessionId);
  const entry: StoredSession = { id: sessionId, createdAt: now, lastSeenAt: now };
  if (meta.ip) entry.ip = meta.ip;
  if (meta.ua) entry.ua = meta.ua;
  current.push(entry);
  current.sort((a, b) => a.createdAt - b.createdAt);

  const max = getMaxSessions(env);
  while (current.length > max) {
    current.shift();
  }

  await writeSessions(env, email, current);
}

export async function ensureSessionActive(env: any, req: Request, email: string, sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  const now = Date.now();
  const rawSessions = await readSessions(env, email);
  const sessions = sanitizeSessions(rawSessions);
  let found = false;
  let changed = sessions.length !== rawSessions.length;

  const ip = getClientIp(req);
  const ua = getUserAgent(req);

  for (const s of sessions) {
    if (s.id !== sessionId) continue;
    found = true;
    if (now - s.lastSeenAt >= TOUCH_INTERVAL_MS) {
      s.lastSeenAt = now;
      changed = true;
    }
    if (ip && ip !== s.ip) {
      s.ip = ip;
      changed = true;
    }
    if (ua && ua !== s.ua) {
      s.ua = ua;
      changed = true;
    }
  }

  if (!found) {
    if (changed) await writeSessions(env, email, sessions);
    return false;
  }

  if (changed) await writeSessions(env, email, sessions);
  return true;
}

export async function revokeSession(env: any, email: string, sessionId: string): Promise<void> {
  if (!sessionId) return;
  const sessions = sanitizeSessions(await readSessions(env, email));
  const next = sessions.filter((s) => s.id !== sessionId);
  if (next.length === sessions.length) return;
  await writeSessions(env, email, next);
}
