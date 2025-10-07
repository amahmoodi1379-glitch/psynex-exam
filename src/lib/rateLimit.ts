import { json } from "./http";
import { getClientIp } from "./requestMeta";

const DEFAULT_LIMIT = 120;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_BLOCK_MS = 2 * 60_000;

type RateBucket = {
  count: number;
  expiresAt: number;
  blockedUntil?: number;
};

const rateBuckets = new Map<string, RateBucket>();

function parseNumber(input: any, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function enforceRateLimit(req: Request, env: any): Response | null {
  if (env && String(env.DISABLE_RATE_LIMIT) === "1") return null;

  const ip = getClientIp(req) || "unknown";
  const limit = parseNumber(env?.RATE_LIMIT_MAX_REQUESTS, DEFAULT_LIMIT);
  const windowMs = parseNumber(env?.RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS);
  const blockMs = parseNumber(env?.RATE_LIMIT_BLOCK_MS, DEFAULT_BLOCK_MS);

  const whitelist = String(env?.RATE_LIMIT_IP_WHITELIST || "")
    .split(",")
    .map((p: string) => p.trim())
    .filter(Boolean);
  if (whitelist.length && whitelist.includes(ip)) return null;

  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (bucket && bucket.blockedUntil && now < bucket.blockedUntil) {
    const retryAfterSec = Math.ceil((bucket.blockedUntil - now) / 1000);
    return json(
      { ok: false, error: "rate_limited", retryAfter: retryAfterSec },
      429,
      { "Retry-After": String(retryAfterSec) }
    );
  }

  if (!bucket || now >= bucket.expiresAt) {
    rateBuckets.set(ip, { count: 1, expiresAt: now + windowMs });
    return null;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    bucket.blockedUntil = now + blockMs;
    rateBuckets.set(ip, bucket);
    const retryAfterSec = Math.ceil(blockMs / 1000);
    return json(
      { ok: false, error: "rate_limited", retryAfter: retryAfterSec },
      429,
      { "Retry-After": String(retryAfterSec) }
    );
  }

  rateBuckets.set(ip, bucket);
  return null;
}
