// src/routes/auth.ts
import { html, json } from "../lib/http";
import { redirect, signJWT, getSessionUser } from "../lib/auth";
import { getUserByEmail, upsertUser, setUserPassword, verifyUserPassword } from "../lib/users";

function isGmail(email: string) {
  return /@gmail\.com$/i.test(email);
}

export function routeAuth(req: Request, url: URL, env?: any): Response | null {
  const p = url.pathname;

  // ---------- صفحه ورود دانشجو ----------
  if (p === "/login" && req.method === "GET") {
    const r = url.searchParams.get("r") || "/student";
    const body = `
      <h1>ورود</h1>
      <div class="card">
        <div>ورود با ایمیل جیمیل و رمز عبور</div>
        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap">
          <input id="email" placeholder="you@gmail.com" style="min-width:260px">
          <input id="pass" type="password" placeholder="رمز عبور">
          <button id="loginBtn">ورود</button>
        </div>
        <div class="muted" style="margin-top:6px">
          حساب ندارید؟ <a href="/signup?r=${encodeURIComponent(r)}">ثبت‌نام</a>
        </div>
      </div>
      <script>
        document.getElementById('loginBtn').addEventListener('click', async ()=>{
          const email = (document.getElementById('email')).value.trim();
          const pass  = (document.getElementById('pass')).value;
          const r = await fetch('/api/auth/login', { method:'POST', headers:{'content-type':'application/json'},
            body: JSON.stringify({ email, password: pass, r: '${r}' }) });
          const d = await r.json();
          if(!d.ok) return alert(d.error||'خطا'); location.href = d.to || '${r}';
        });
      </script>
    `;
    return html(body);
  }

  // ---------- صفحه ثبت‌نام دانشجو ----------
  if (p === "/signup" && req.method === "GET") {
    const allowed = (env.ALLOW_SELF_SIGNUP ?? "1") === "1";
    const r = url.searchParams.get("r") || "/student";
    const body = allowed ? `
      <h1>ثبت‌نام</h1>
      <div class="card">
        <div>فقط ایمیل‌های Gmail مجاز هستند.</div>
        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap">
          <input id="email" placeholder="you@gmail.com" style="min-width:260px">
          <input id="pass" type="password" placeholder="رمز عبور (حداقل 8 کاراکتر)">
          <button id="signupBtn">ثبت‌نام</button>
        </div>
      </div>
      <script>
        document.getElementById('signupBtn').addEventListener('click', async ()=>{
          const email = (document.getElementById('email')).value.trim();
          const pass  = (document.getElementById('pass')).value;
          const r = await fetch('/api/auth/signup', { method:'POST', headers:{'content-type':'application/json'},
            body: JSON.stringify({ email, password: pass, r: '${r}' }) });
          const d = await r.json();
          if(!d.ok) return alert(d.error||'خطا'); location.href = d.to || '${r}';
        });
      </script>
    ` : `
      <h1>ثبت‌نام</h1>
      <div class="card">ثبت‌نام عمومی غیرفعال است. لطفاً با مدیر تماس بگیرید.</div>
    `;
    return html(body);
  }

  // ---------- API: ثبت‌نام ----------
  if (p === "/api/auth/signup" && req.method === "POST") {
    return (async () => {
      if ((env.ALLOW_SELF_SIGNUP ?? "1") !== "1") return json({ ok:false, error:"signup_disabled" }, 403);
      const body = await req.json();
      const email = String(body?.email || "").toLowerCase();
      const password = String(body?.password || "");
      const to = body?.r || "/student";
      if (!email || !password) return json({ ok:false, error:"bad_request" }, 400);
      if (!isGmail(email)) return json({ ok:false, error:"only_gmail_allowed" }, 400);
      if (password.length < 8) return json({ ok:false, error:"weak_password" }, 400);

      const exists = await getUserByEmail(env, email);
      if (exists) return json({ ok:false, error:"email_exists" }, 400);

      await upsertUser(env, { email, role:"student", planTier:"free", status:"active" });
      await setUserPassword(env, email, password);

      const token = await signJWT({
        email, name:"", picture:"", role:"student", planTier:"free", planExpiresAt:null
      }, env.JWT_SECRET, 60*60*24*30);

      return new Response(JSON.stringify({ ok:true, to }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "Set-Cookie": `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60*60*24*30}`
        }
      });
    })();
  }

  // ---------- API: ورود دانشجو ----------
  if (p === "/api/auth/login" && req.method === "POST") {
    return (async () => {
      const body = await req.json();
      const email = String(body?.email || "").toLowerCase();
      const password = String(body?.password || "");
      const to = body?.r || "/student";
      if (!email || !password) return json({ ok:false, error:"bad_request" }, 400);
      if (!isGmail(email)) return json({ ok:false, error:"only_gmail_allowed" }, 400);

      const u = await verifyUserPassword(env, email, password);
      if (!u) return json({ ok:false, error:"invalid_credentials" }, 401);
      if (u.status !== "active") return json({ ok:false, error:"disabled_user" }, 403);

      const token = await signJWT({
        email: u.email, name: u.name, picture: u.picture, role: u.role,
        planTier: u.planTier, planExpiresAt: u.planExpiresAt ?? null
      }, env.JWT_SECRET, 60*60*24*30);

      return new Response(JSON.stringify({ ok:true, to }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "Set-Cookie": `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60*60*24*30}`
        }
      });
    })();
  }

  // ---------- صفحه مخفی مدیر/ادمین (/root) ----------
  if (p === "/root" && req.method === "GET") {
    const body = `
      <h1>Secure Access</h1>
      <div class="card">
        <div>ورود ویژهٔ مدیر/ادمین با <b>کد دسترسی</b> (Access Code)</div>
        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap">
          <input id="email" placeholder="admin@gmail.com" style="min-width:260px">
          <input id="pass" type="password" placeholder="رمز عبور (اگر کاربر تازه است، همین ست می‌شود)">
          <input id="code" placeholder="Access Code">
          <button id="rootBtn">ورود ویژه</button>
        </div>
        <div class="muted" style="margin-top:6px">اگر کاربری با این ایمیل موجود نباشد و کد درست باشد، ایجاد می‌شود.</div>
      </div>
      <script>
        document.getElementById('rootBtn').addEventListener('click', async ()=>{
          const email = (document.getElementById('email')).value.trim();
          const pass  = (document.getElementById('pass')).value;
          const code  = (document.getElementById('code')).value.trim();
          const r = await fetch('/api/auth/root', { method:'POST', headers:{'content-type':'application/json'},
            body: JSON.stringify({ email, password: pass, code }) });
          const d = await r.json();
          if(!d.ok) return alert(d.error||'خطا'); location.href = d.to || '/management';
        });
      </script>
    `;
    return html(body);
  }

  // ---------- API: ورود/ایجاد مدیر/ادمین با کُد ----------
  if (p === "/api/auth/root" && req.method === "POST") {
    return (async () => {
      const body = await req.json();
      const email = String(body?.email || "").toLowerCase();
      const password = String(body?.password || "");
      const code = String(body?.code || "");
      if (!email || !code) return json({ ok:false, error:"bad_request" }, 400);
      if (!isGmail(email)) return json({ ok:false, error:"only_gmail_allowed" }, 400);

      const adminCode = env.ADMIN_ACCESS_CODE || "";
      const managerCode = env.MANAGER_ACCESS_CODE || "";
      let targetRole: "admin" | "manager" | null = null;
      if (adminCode && code === adminCode) targetRole = "admin";
      else if (managerCode && code === managerCode) targetRole = "manager";
      if (!targetRole) return json({ ok:false, error:"invalid_code" }, 403);

      // اگر لیست سفید تعریف شده، ایمیل باید داخلش باشد
      const wl = (env.ADMIN_WHITELIST || "").toLowerCase().split(",").map((s:string)=>s.trim()).filter(Boolean);
      if (targetRole === "admin" && wl.length && !wl.includes(email)) {
        return json({ ok:false, error:"not_in_whitelist" }, 403);
      }

      let u = await getUserByEmail(env, email);
      if (!u) {
        // کاربر جدید
        await upsertUser(env, { email, role: targetRole, planTier: "pro2", status: "active" });
        if (password && password.length >= 8) await setUserPassword(env, email, password);
        else return json({ ok:false, error:"set_strong_password" }, 400);
        u = await getUserByEmail(env, email);
      } else {
        // کاربر موجود: باید پسورد را تایید کند
        const ok = await verifyUserPassword(env, email, password);
        if (!ok) return json({ ok:false, error:"invalid_credentials" }, 401);
        await upsertUser(env, { email, role: targetRole, status: "active" });
        u = await getUserByEmail(env, email);
      }

      const token = await signJWT({
        email: u!.email, name: u!.name, picture: u!.picture,
        role: (u as any).role, planTier: (u as any).planTier, planExpiresAt: (u as any).planExpiresAt ?? null
      }, env.JWT_SECRET, 60*60*24*30);

      const to = targetRole === "admin" ? "/admin" : "/management";
      return new Response(JSON.stringify({ ok:true, to }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "Set-Cookie": `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60*60*24*30}`
        }
      });
    })();
  }

  // ---------- خروج ----------
  if (p === "/logout") {
    return new Response("", {
      status: 302,
      headers: {
        "Set-Cookie": "sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
        "Location": "/"
      }
    });
  }

  // ---------- وضعیت من ----------
  if (p === "/api/me") {
    return (async () => {
      const me = await getSessionUser(req, env);
      return json({ ok: true, me });
    })();
  }

  return null;
}
