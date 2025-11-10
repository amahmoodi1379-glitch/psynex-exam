// src/routes/auth.ts
import { html, json, page } from "../lib/http";
import { redirect, signJWT, getSessionUser } from "../lib/auth";
import { getUserByEmail, upsertUser, setUserPassword, verifyUserPassword } from "../lib/users";

function isGmail(email: string) {
  return /@gmail\.com$/i.test(email);
}

const enc = new TextEncoder();
const b64 = {
  enc: (buf: ArrayBuffer | Uint8Array) => {
    const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let out = "";
    for (const b of arr) out += String.fromCharCode(b);
    return btoa(out);
  },
  dec: (b64: string) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
};

const SIGNUP_CODE_TTL_MS = 10 * 60 * 1000; // 10 دقیقه
const SIGNUP_RESEND_INTERVAL_MS = 60 * 1000;
const SIGNUP_MAX_ATTEMPTS = 5;
const signupKey = (email: string) => `signup:challenge:${email.toLowerCase()}`;

type SignupChallenge = {
  saltB64: string;
  hashB64: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
};

function generateCode(): string {
  const buf = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(buf % 1_000_000).padStart(6, "0");
}

async function hashCode(code: string, salt: Uint8Array): Promise<string> {
  const trimmed = code.trim();
  const data = enc.encode(trimmed);
  const merged = new Uint8Array(salt.length + data.length);
  merged.set(salt, 0);
  merged.set(data, salt.length);
  const digest = await crypto.subtle.digest("SHA-256", merged);
  return b64.enc(digest);
}

async function readChallenge(env: any, email: string): Promise<SignupChallenge | null> {
  const raw = await env.DATA.get(signupKey(email));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<SignupChallenge>;
  return {
    saltB64: parsed.saltB64 || "",
    hashB64: parsed.hashB64 || "",
    expiresAt: parsed.expiresAt || 0,
    attempts: parsed.attempts ?? 0,
    lastSentAt: parsed.lastSentAt ?? 0,
  };
}

async function storeChallenge(env: any, email: string): Promise<{ code: string; expiresAt: number; }> {
  const code = generateCode();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashB64 = await hashCode(code, salt);
  const challenge: SignupChallenge = {
    saltB64: b64.enc(salt),
    hashB64,
    expiresAt: Date.now() + SIGNUP_CODE_TTL_MS,
    attempts: 0,
    lastSentAt: Date.now(),
  };
  await env.DATA.put(signupKey(email), JSON.stringify(challenge));
  return { code, expiresAt: challenge.expiresAt };
}

async function deleteChallenge(env: any, email: string) {
  await env.DATA.delete(signupKey(email));
}

async function markFailedAttempt(env: any, email: string, challenge: SignupChallenge): Promise<SignupChallenge | null> {
  const next = { ...challenge, attempts: (challenge.attempts || 0) + 1 };
  if (next.attempts >= SIGNUP_MAX_ATTEMPTS) {
    await deleteChallenge(env, email);
    return null;
  }
  await env.DATA.put(signupKey(email), JSON.stringify(next));
  return next;
}

async function deliverCode(env: any, email: string, code: string) {
  try {
    if (typeof env.SEND_VERIFICATION_EMAIL === "function") {
      await env.SEND_VERIFICATION_EMAIL(email, code);
      return;
    }
    if (env.SIGNUP_EMAIL_WEBHOOK) {
      await fetch(env.SIGNUP_EMAIL_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code })
      });
      return;
    }
  } catch (err) {
    console.error("signup_email_error", err);
  }
  console.log(`[signup] verification code for ${email}: ${code}`);
}

export function routeAuth(req: Request, url: URL, env?: any): Response | null {
  const p = url.pathname;

  // ---------- صفحه ورود دانشجو ----------
  if (p === "/login" && req.method === "GET") {
    const r = url.searchParams.get("r") || "/student";
    const body = `
      <div class="card">
        <h2>ورود به حساب کاربری</h2>
        <p class="muted">ورود با ایمیل جیمیل و رمز عبور</p>
        <div style="margin-top:16px; display:flex; flex-wrap:wrap; gap:8px; align-items:center">
          <input id="email" type="email" placeholder="you@gmail.com" style="min-width:260px">
          <input id="pass" type="password" placeholder="رمز عبور">
          <button id="loginBtn">ورود</button>
        </div>
        <p class="muted" style="margin-top:12px">
          حساب ندارید؟ <a href="/signup?r=${encodeURIComponent(r)}">ثبت‌نام</a>
        </p>
      </div>
      <script>
        document.getElementById('loginBtn').addEventListener('click', async ()=>{
          const email = (document.getElementById('email')).value.trim();
          const pass  = (document.getElementById('pass')).value;
          const resp = await fetch('/api/auth/login', { method:'POST', headers:{'content-type':'application/json'},
            body: JSON.stringify({ email, password: pass, r: '${r}' }) });
          const d = await resp.json();
          if(!d.ok) return alert(d.error||'خطا'); location.href = d.to || '${r}';
        });
      </script>
    `;
    return html(page("ورود", body));
  }

  // ---------- صفحه ثبت‌نام دانشجو ----------
  if (p === "/signup" && req.method === "GET") {
    const allowed = (env.ALLOW_SELF_SIGNUP ?? "1") === "1";
    const r = url.searchParams.get("r") || "/student";
    const body = allowed ? `
      <div class="card">
        <h2>ثبت‌نام</h2>
        <p class="muted">فقط ایمیل‌های Gmail مجاز هستند. ابتدا ایمیل را تأیید کنید یا از Google استفاده کنید.</p>
        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap">
          <button id="googleBtn" class="btn-google">
            <span>ورود با Google</span>
          </button>
        </div>
        <p class="muted" style="margin-top:8px">یا ایمیل Gmail خود را وارد کنید تا کد تأیید ارسال شود.</p>
        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap">
          <input id="email" placeholder="you@gmail.com" style="min-width:260px">
          <button id="signupBtn">ارسال کد تأیید</button>
        </div>
        <div id="verifyStep" style="margin-top:10px; display:none; flex-wrap:wrap; gap:8px">
          <input id="code" placeholder="کد ۶ رقمی">
          <input id="pass" type="password" placeholder="رمز عبور (حداقل 8 کاراکتر)">
          <button id="completeBtn">تکمیل ثبت‌نام</button>
        </div>
        <div id="signupStatus" class="muted" style="margin-top:6px"></div>
      </div>
      <script>
        (function(){
          const emailInput = document.getElementById('email');
          const sendBtn = document.getElementById('signupBtn');
          const verifyStep = document.getElementById('verifyStep');
          const statusEl = document.getElementById('signupStatus');
          const codeInput = document.getElementById('code');
          const passInput = document.getElementById('pass');
          const completeBtn = document.getElementById('completeBtn');
          const redirectTo = '${r}';

          document.getElementById('googleBtn').addEventListener('click', () => {
            alert('ورود مستقیم با Google به زودی فعال می‌شود. فعلاً از تأیید ایمیل استفاده کنید.');
          });

          async function sendRequest(){
            const email = emailInput.value.trim();
            if(!email) return alert('ایمیل را وارد کنید.');
            sendBtn.disabled = true;
            statusEl.textContent = 'در حال ارسال کد...';
            try {
              const res = await fetch('/api/auth/signup', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email }) });
              const data = await res.json();
              if(!data.ok){
                statusEl.textContent = '';
                if(data.error === 'too_soon' && data.retryAfter){
                  alert('لطفاً چند لحظه دیگر دوباره تلاش کنید.');
                } else {
                  alert(data.error || 'خطا');
                }
              } else {
                verifyStep.style.display = 'flex';
                statusEl.textContent = 'کد تأیید به ایمیل ارسال شد. لطفاً صندوق ورودی یا Spam را بررسی کنید.';
                sendBtn.textContent = 'ارسال مجدد کد';
              }
            } catch(err){
              console.error(err);
              alert('خطا در ارسال درخواست');
            } finally {
              sendBtn.disabled = false;
            }
          }

          async function completeSignup(){
            const email = emailInput.value.trim();
            const code = codeInput.value.trim();
            const password = passInput.value;
            if(!email || !code || !password) return alert('تمام فیلدها را تکمیل کنید.');
            completeBtn.disabled = true;
            statusEl.textContent = 'در حال بررسی کد...';
            try {
              const res = await fetch('/api/auth/signup/verify', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email, code, password, r: redirectTo }) });
              const data = await res.json();
              if(!data.ok){
                statusEl.textContent = '';
                alert(data.error || 'کد نامعتبر است.');
              } else {
                statusEl.textContent = 'ثبت‌نام تکمیل شد.';
                location.href = data.to || redirectTo;
              }
            } catch(err){
              console.error(err);
              alert('خطا در تکمیل ثبت‌نام');
            } finally {
              completeBtn.disabled = false;
            }
          }

          sendBtn.addEventListener('click', sendRequest);
          completeBtn.addEventListener('click', completeSignup);
        })();
      </script>
    ` : `
      <div class="card">
        <h2>ثبت‌نام</h2>
        <p class="muted">ثبت‌نام عمومی غیرفعال است. لطفاً با مدیر تماس بگیرید.</p>
      </div>
    `;
    return html(page("ثبت‌نام", body));
  }

  // ---------- API: ثبت‌نام ----------
  if (p === "/api/auth/signup" && req.method === "POST") {
    return (async () => {
      if ((env.ALLOW_SELF_SIGNUP ?? "1") !== "1") return json({ ok:false, error:"signup_disabled" }, 403);
      const body = await req.json();
      const email = String(body?.email || "").toLowerCase().trim();
      if (!email) return json({ ok:false, error:"email_required" }, 400);
      if (!isGmail(email)) return json({ ok:false, error:"only_gmail_allowed" }, 400);

      const existing = await getUserByEmail(env, email);
      if (existing) {
        if (existing.status === "active") return json({ ok:false, error:"email_exists" }, 400);
        if (existing.status === "disabled") return json({ ok:false, error:"account_disabled" }, 403);
      }

      const challenge = await readChallenge(env, email);
      const now = Date.now();
      if (challenge && challenge.expiresAt > now) {
        const lastSent = challenge.lastSentAt ?? 0;
        if (lastSent && (now - lastSent) < SIGNUP_RESEND_INTERVAL_MS) {
          const retryAfter = Math.max(0, SIGNUP_RESEND_INTERVAL_MS - (now - lastSent));
          return json({ ok:false, error:"too_soon", retryAfter }, 429);
        }
      }

      const { code, expiresAt } = await storeChallenge(env, email);
      await upsertUser(env, {
        email,
        role: existing?.role ?? "student",
        planTier: existing?.planTier ?? "free",
        status: "pending"
      });

      await deliverCode(env, email, code);

      return json({ ok:true, step:"verify", expiresAt });
    })();
  }

  // ---------- API: تایید کد ثبت‌نام ----------
  if (p === "/api/auth/signup/verify" && req.method === "POST") {
    return (async () => {
      if ((env.ALLOW_SELF_SIGNUP ?? "1") !== "1") return json({ ok:false, error:"signup_disabled" }, 403);
      const body = await req.json();
      const email = String(body?.email || "").toLowerCase().trim();
      const code = String(body?.code || "").trim();
      const password = String(body?.password || "");
      const to = body?.r || "/student";
      if (!email || !code || !password) return json({ ok:false, error:"bad_request" }, 400);
      if (!/^\d{6}$/.test(code)) return json({ ok:false, error:"invalid_code" }, 400);
      if (!isGmail(email)) return json({ ok:false, error:"only_gmail_allowed" }, 400);
      if (password.length < 8) return json({ ok:false, error:"weak_password" }, 400);

      const user = await getUserByEmail(env, email);
      if (!user) return json({ ok:false, error:"no_pending_signup" }, 400);
      if (user.status === "disabled") return json({ ok:false, error:"account_disabled" }, 403);
      if (user.status === "active") return json({ ok:false, error:"already_verified" }, 400);

      const challenge = await readChallenge(env, email);
      if (!challenge) return json({ ok:false, error:"code_not_found" }, 400);
      const now = Date.now();
      if (now > challenge.expiresAt) {
        await deleteChallenge(env, email);
        return json({ ok:false, error:"code_expired" }, 400);
      }

      const salt = b64.dec(challenge.saltB64);
      const hashed = await hashCode(code, salt);
      if (hashed !== challenge.hashB64) {
        const next = await markFailedAttempt(env, email, challenge);
        if (!next) return json({ ok:false, error:"too_many_attempts" }, 400);
        return json({ ok:false, error:"invalid_code" }, 400);
      }

      await deleteChallenge(env, email);
      await setUserPassword(env, email, password);
      const active = await upsertUser(env, { email, status: "active", role: user.role ?? "student" });

      const token = await signJWT({
        email: active.email,
        name: active.name ?? "",
        picture: active.picture ?? "",
        role: active.role,
        planTier: active.planTier,
        planExpiresAt: active.planExpiresAt ?? null
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

      const user = await getUserByEmail(env, email);
      if (!user) return json({ ok:false, error:"invalid_credentials" }, 401);
      if (user.status === "pending") return json({ ok:false, error:"pending_verification" }, 403);
      if (user.status !== "active") return json({ ok:false, error:"disabled_user" }, 403);

      const verified = await verifyUserPassword(env, email, password);
      if (!verified) return json({ ok:false, error:"invalid_credentials" }, 401);

      const token = await signJWT({
        email: verified.email, name: verified.name, picture: verified.picture, role: verified.role,
        planTier: verified.planTier, planExpiresAt: verified.planExpiresAt ?? null
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
      <div class="card">
        <h2>ورود ویژه</h2>
        <p class="muted">ورود ویژهٔ مدیر/ادمین با <b>کد دسترسی</b> (Access Code)</p>
        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap">
          <input id="email" placeholder="admin@gmail.com" style="min-width:260px">
          <input id="pass" type="password" placeholder="رمز عبور (اگر کاربر تازه است، همین ست می‌شود)">
          <input id="code" placeholder="Access Code">
          <button id="rootBtn">ورود ویژه</button>
        </div>
        <p class="muted" style="margin-top:6px">اگر کاربری با این ایمیل موجود نباشد و کد درست باشد، ایجاد می‌شود.</p>
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
    return html(page("ورود ویژه", body));
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
        await upsertUser(env, { email, role: targetRole, planTier: "level2", status: "active" });
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
