// src/lib/users.ts
import type { Role } from "./auth";

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
