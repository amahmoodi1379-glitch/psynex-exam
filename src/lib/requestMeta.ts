export function getClientIp(req: Request): string | null {
  const cf = req.headers.get("CF-Connecting-IP");
  if (cf && cf.trim()) return cf.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff && xff.trim()) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const real = req.headers.get("X-Real-IP");
  if (real && real.trim()) return real.trim();

  const remote = req.headers.get("Remote-Addr");
  if (remote && remote.trim()) return remote.trim();

  return null;
}

export function getUserAgent(req: Request): string {
  return req.headers.get("user-agent") || "";
}
