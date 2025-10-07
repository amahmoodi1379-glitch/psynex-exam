type RateBucket = {
  count: number;
  expiresAt: number;
  blockedUntil?: number;
};

const BUCKET_KEY = "bucket";

const DEFAULT_BUCKET: RateBucket = {
  count: 0,
  expiresAt: 0,
};

type RateLimitRequest = {
  limit: number;
  windowMs: number;
  blockMs: number;
  now: number;
};

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sanitizeRequest(data: any): RateLimitRequest | null {
  const limit = Number(data?.limit);
  const windowMs = Number(data?.windowMs);
  const blockMs = Number(data?.blockMs);
  const now = Number(data?.now);

  if (!isPositiveInt(limit) || !isPositiveInt(windowMs) || !isPositiveInt(blockMs) || !Number.isFinite(now)) {
    return null;
  }

  return {
    limit: Math.floor(limit),
    windowMs: Math.floor(windowMs),
    blockMs: Math.floor(blockMs),
    now: Math.floor(now),
  };
}

function buildResponse(limited: boolean, retryAfter?: number): Response {
  return new Response(JSON.stringify({ limited, retryAfter }), {
    status: limited ? 429 : 200,
    headers: { "content-type": "application/json" },
  });
}

function resetBucket(now: number, windowMs: number): RateBucket {
  return {
    count: 1,
    expiresAt: now + windowMs,
  };
}

export class RateLimiterDO {
  private readonly state: any;

  constructor(state: any) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let payload: RateLimitRequest | null = null;
    try {
      const data = await request.json();
      payload = sanitizeRequest(data);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    if (!payload) {
      return new Response("Bad Request", { status: 400 });
    }

    const { limit, windowMs, blockMs, now } = payload;
    let bucket = (await this.state.storage.get<RateBucket>(BUCKET_KEY)) ?? { ...DEFAULT_BUCKET };

    if (bucket.blockedUntil && now < bucket.blockedUntil) {
      const retryAfter = Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
      return buildResponse(true, retryAfter);
    }

    if (now >= bucket.expiresAt) {
      bucket = resetBucket(now, windowMs);
    } else {
      bucket.count += 1;
      if (bucket.count > limit) {
        bucket.blockedUntil = now + blockMs;
        bucket.count = 0;
        bucket.expiresAt = now + windowMs;
        await this.state.storage.put(BUCKET_KEY, bucket);
        const retryAfter = Math.max(1, Math.ceil(blockMs / 1000));
        return buildResponse(true, retryAfter);
      }
    }

    if (bucket.blockedUntil && now >= bucket.blockedUntil) {
      delete bucket.blockedUntil;
    }

    await this.state.storage.put(BUCKET_KEY, bucket);
    return buildResponse(false);
  }
}
