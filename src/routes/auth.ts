// src/routes/auth.ts
import { html, json } from "../lib/http";
import { redirect, signJWT, getSessionUser } from "../lib/auth";
import { getUserByEmail, upsertUser } from "../lib/users";

export function routeAuth(req: Request, url: URL, env?: any): Response | null {
  const p = url.pathname;

  if (p === "/login" && req.method === "GET") {
    const r = url.searchParams.get("r") || "/student";
    const body = `
      <h1>ورود</h1>
      <p class="muted">ورود فقط با حساب گوگل (Gmail)</p>
      <a href="/auth/start?r=${encodeURIComponent(r)}"><button>ورود با گوگل</button></a>
    `;
    return html(body);
  }

  if (p === "/auth/start" && req.method === "GET") {
    const r = url.searchParams.get("r") || "/student";
    const state = crypto.randomUUID();
    const redirectUri = new URL("/auth/callback", url.origin).toString();
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("access_type", "online");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state + "|" + encodeURIComponent(r));
    const headers = {
      "Set-Cookie": `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
    };
    return redirect(authUrl.toString(), headers);
  }

  if (p === "/auth/callback" && req.method === "GET") {
    return (async () => {
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const co = (req.headers.get("Cookie") || "");
      const st = co.split(";").map(s => s.trim()).find(s => s.startsWith("oauth_state="))?.split("=")[1];
      if (!code || !state || !st || !state.startsWith(st)) {
        return html("<h3>Invalid OAuth state</h3>", 400);
      }
      const after = decodeURIComponent(state.split("|")[1] || "/student");
      const redirectUri = new URL("/auth/callback", url.origin).toString();
      // token exchange
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code"
        })
      });
      if (!tokenRes.ok) {
        const t = await tokenRes.text();
        return html("<pre>Token error:\n" + t + "</pre>", 400);
      }
      const tk = await tokenRes.json() as { access_token: string };
      // userinfo
      const uiRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tk.access_token}` }
      });
      const ui = await uiRes.json() as { email: string; email_verified: boolean; name?: string; picture?: string };
      if (!ui?.email || !ui.email_verified) {
        return html("<h3>ایمیل شما در گوگل وریفای نشده است.</h3>", 403);
      }

      // ایجاد/به‌روز کاربر
      const prev = await getUserByEmail(env, ui.email);
      const user = await upsertUser(env, {
        email: ui.email,
        name: ui.name,
        picture: ui.picture,
        role: prev?.role ?? "student",
        planTier: prev?.planTier ?? "free",
        planExpiresAt: prev?.planExpiresAt ?? null,
        status: "active",
      });

      // صدور سشن
      const token = await signJWT({
        email: user.email, name: user.name, picture: user.picture,
        role: user.role, planTier: user.planTier, planExpiresAt: user.planExpiresAt ?? null
      }, env.JWT_SECRET, 60 * 60 * 24 * 30);

      const headers = {
        "Set-Cookie": `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`,
        "Location": after
      };
      return new Response("", { status: 302, headers });
    })();
  }

  if (p === "/logout") {
    return new Response("Logged out", {
      status: 302,
      headers: {
        "Set-Cookie": "sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
        "Location": "/"
      }
    });
  }

  // وضعیت فعلی
  if (p === "/api/me") {
    return (async () => {
      const me = await getSessionUser(req, env);
      return json({ ok: true, me });
    })();
  }

  return null;
}
