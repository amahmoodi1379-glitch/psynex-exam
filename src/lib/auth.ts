// src/lib/auth.ts
import { ensureSessionActive, SESSION_COOKIE_NAME } from "./sessionStore";

export type Role = "student" | "manager" | "admin";
const roleRank: Record<Role, number> = { student: 1, manager: 2, admin: 3 };

export type SessionPayload = {
  email: string;
  name?: string;
  picture?: string;
  role: Role;
  planTier: "free" | "pro1" | "pro2" | "pro3";
  planExpiresAt?: number | null;
  sessionId: string;
  iat: number;
  exp: number;
};

const enc = new TextEncoder();
const b64u = {
  enc: (buf: ArrayBuffer) => {
    const b = String.fromCharCode(...new Uint8Array(buf));
    return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  },
  encStr: (s: string) => btoau(s),
  decStr: (s: string) => atoub(s),
};
function btoau(s: string) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function atoub(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  if (pad) s += "=".repeat(pad);
  return atob(s);
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signJWT(payload: Omit<SessionPayload, "iat" | "exp">, secret: string, ttlSec = 60 * 60 * 24 * 30) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const pl: SessionPayload = { ...payload, iat: now, exp: now + ttlSec };
  const h = b64u.encStr(JSON.stringify(header));
  const p = b64u.encStr(JSON.stringify(pl));
  const toSign = enc.encode(`${h}.${p}`);
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, toSign);
  const s = b64u.enc(sig);
  return `${h}.${p}.${s}`;
}

export async function verifyJWT<T = SessionPayload>(token: string, secret: string): Promise<T | null> {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify("HMAC", key, Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const payload: T = JSON.parse(b64u.decStr(p));
    // @ts-ignore
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch { return null; }
}

export function parseCookies(req: Request) {
  const h = req.headers.get("Cookie") || "";
  const out: Record<string, string> = {};
  h.split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1));
  });
  return out;
}

export async function getSessionUser(req: Request, env: any): Promise<SessionPayload | null> {
  const c = parseCookies(req);
  const t = c[SESSION_COOKIE_NAME];
  if (!t) return null;
  const payload = await verifyJWT<SessionPayload>(t, env.JWT_SECRET);
  if (!payload || typeof payload.sessionId !== "string" || !payload.sessionId) return null;
  const active = await ensureSessionActive(env, req, payload.email, payload.sessionId);
  if (!active) return null;
  return payload;
}

export function redirect(url: string, headers: HeadersInit = {}) {
  return new Response("", { status: 302, headers: { Location: url, ...headers } });
}

export async function requireRole(req: Request, env: any, min: Role): Promise<SessionPayload | Response> {
  const u = await getSessionUser(req, env);
  if (!u || roleRank[u.role] < roleRank[min]) {
    const uurl = new URL(req.url);
    const to = "/login?r=" + encodeURIComponent(uurl.pathname + uurl.search);
    return redirect(to);
  }
  return u;
}
