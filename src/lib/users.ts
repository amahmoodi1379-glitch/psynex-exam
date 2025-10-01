// src/lib/users.ts
import type { Role } from "./auth";

export type PwHash = {
  alg: "pbkdf2";
  iter: number;
  saltB64: string;
  hashB64: string;
};

export type User = {
  email: string;
  name?: string;
  picture?: string;
  role: Role;
  planTier: "free" | "pro1" | "pro2" | "pro3";
  planExpiresAt?: number | null;
  createdAt: number;
  updatedAt: number;
  status: "active" | "disabled";
  pw?: PwHash; // ← پسورد هش‌شده (اختیاری)
};

const keyU = (email: string) => `user:${email.toLowerCase()}`;

export async function getUserByEmail(env: any, email: string): Promise<User | null> {
  const raw = await env.DATA.get(keyU(email));
  return raw ? JSON.parse(raw) : null;
}

export async function upsertUser(env: any, u: Partial<User> & { email: string }): Promise<User> {
  const prev = await getUserByEmail(env, u.email);
  const now = Date.now();
  const next: User = {
    email: u.email.toLowerCase(),
    name: u.name ?? prev?.name ?? "",
    picture: u.picture ?? prev?.picture ?? "",
    role: (u.role ?? prev?.role ?? "student") as Role,
    planTier: (u.planTier ?? prev?.planTier ?? "free"),
    planExpiresAt: (u.planExpiresAt ?? prev?.planExpiresAt ?? null),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    status: (u.status ?? prev?.status ?? "active"),
    pw: u.pw ?? prev?.pw ?? undefined,
  };
  await env.DATA.put(keyU(next.email), JSON.stringify(next));
  return next;
}

export async function deleteUser(env: any, email: string) {
  await env.DATA.delete(keyU(email));
}

export async function listUsers(env: any, limit = 1000): Promise<User[]> {
  const out: User[] = [];
  let cursor: string | undefined;
  while (true) {
    const res = await env.DATA.list({ prefix: "user:", limit: 1000, cursor });
    for (const k of res.keys) {
      const raw = await env.DATA.get(k.name);
      if (!raw) continue;
      out.push(JSON.parse(raw));
      if (out.length >= limit) return out;
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return out;
}

// ---------- Password helpers (PBKDF2-SHA256) ----------
const enc = new TextEncoder();
const b64 = {
  enc: (buf: ArrayBuffer) => {
    const b = String.fromCharCode(...new Uint8Array(buf));
    return btoa(b);
  }
};

async function pbkdf2(password: string, salt: Uint8Array, iter = 100_000, len = 32): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    key,
    len * 8
  );
}

export async function setUserPassword(env: any, email: string, plain: string, iter = 100_000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(plain, salt, iter, 32);
  const user = await upsertUser(env, {
    email,
    pw: { alg: "pbkdf2", iter, saltB64: b64.enc(salt), hashB64: b64.enc(hash) }
  });
  return user;
}

export async function verifyUserPassword(env: any, email: string, plain: string): Promise<User | null> {
  const u = await getUserByEmail(env, email);
  if (!u || !u.pw || u.status !== "active") return null;
  try {
    const salt = Uint8Array.from(atob(u.pw.saltB64), c => c.charCodeAt(0));
    const bits = await pbkdf2(plain, salt, u.pw.iter, 32);
    const h = b64.enc(bits);
    return h === u.pw.hashB64 ? u : null;
  } catch { return null; }
}
