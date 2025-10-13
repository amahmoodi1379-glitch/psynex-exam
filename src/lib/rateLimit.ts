import { json } from "./http";
import { getClientIp } from "./requestMeta";

const DEFAULT_LIMIT = 120;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_BLOCK_MS = 2 * 60_000;

type LocalBucket = {
  count: number;
  expiresAt: number;
  blockedUntil?: number;
};

const fallbackBuckets = new Map<string, LocalBucket>();

function parseNumber(input: any, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseWhitelist(raw: any): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

type RateLimitResult = {
  limited: boolean;
  retryAfter?: number;
};

async function evaluateLimit(
  env: any,
  ip: string,
  limit: number,
  windowMs: number,
  blockMs: number
): Promise<RateLimitResult | null> {
  if (!env?.RATE_LIMITER) return null;

  try {
    const id = env.RATE_LIMITER.idFromName(ip);
    const stub = env.RATE_LIMITER.get(id);
    const res = await stub.fetch("https://rate.limit/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit, windowMs, blockMs, now: Date.now() }),
    });

    if (res.status === 200) {
      return { limited: false };
    }

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const retryAfter = Number(data?.retryAfter);
      return {
        limited: true,
        retryAfter: Number.isFinite(retryAfter) ? retryAfter : Math.ceil(blockMs / 1000),
      };
    }
  } catch (err) {
    console.warn("rate_limit_error", err);
  }

  return null;
}

function evaluateFallback(
  ip: string,
  limit: number,
  windowMs: number,
  blockMs: number
): RateLimitResult {
  const now = Date.now();
  const bucket = fallbackBuckets.get(ip);

  if (bucket && bucket.blockedUntil && now < bucket.blockedUntil) {
    const retryAfter = Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
    return { limited: true, retryAfter };
  }

  if (!bucket || now >= bucket.expiresAt) {
    fallbackBuckets.set(ip, { count: 1, expiresAt: now + windowMs });
    return { limited: false };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    bucket.blockedUntil = now + blockMs;
    bucket.count = 0;
    bucket.expiresAt = now + windowMs;
    fallbackBuckets.set(ip, bucket);
    const retryAfter = Math.max(1, Math.ceil(blockMs / 1000));
    return { limited: true, retryAfter };
  }

  if (bucket.blockedUntil && now >= bucket.blockedUntil) {
    delete bucket.blockedUntil;
  }

  fallbackBuckets.set(ip, bucket);
  return { limited: false };
}

export async function enforceRateLimit(req: Request, env: any): Promise<Response | null> {
  if (env && String(env.DISABLE_RATE_LIMIT) === "1") return null;

  const ip = getClientIp(req);
  if (!ip) return null;

  const whitelist = parseWhitelist(env?.RATE_LIMIT_IP_WHITELIST);
  if (whitelist.length && whitelist.includes(ip)) return null;

  const limit = parseNumber(env?.RATE_LIMIT_MAX_REQUESTS, DEFAULT_LIMIT);
  const windowMs = parseNumber(env?.RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS);
  const blockMs = parseNumber(env?.RATE_LIMIT_BLOCK_MS, DEFAULT_BLOCK_MS);

  let result = await evaluateLimit(env, ip, limit, windowMs, blockMs);
  if (!result) {
    result = evaluateFallback(ip, limit, windowMs, blockMs);
  }
  if (!result.limited) return null;

  const retryAfterSec = Math.max(1, Math.ceil(result.retryAfter ?? blockMs / 1000));
  return json(
    { ok: false, error: "rate_limited", retryAfter: retryAfterSec },
    429,
    { "Retry-After": String(retryAfterSec) }
  );
}
