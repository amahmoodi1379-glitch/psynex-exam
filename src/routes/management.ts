// src/routes/management.ts
import { html, json, page } from "../lib/http";
import { requireRole } from "../lib/auth";
import { listUsers, upsertUser, deleteUser } from "../lib/users";

export function routeManagement(req: Request, url: URL, env?: any): Response | null {
  const p = url.pathname;

  // APIها (نیاز به manager به بالا)
  if (p === "/api/users" && req.method === "GET") {
    return (async () => {
      const r = await requireRole(req, env, "manager"); if (r instanceof Response) return r;
      const users = await listUsers(env, 5000);
      users.sort((a,b)=> a.createdAt - b.createdAt);
      return json({ ok: true, total: users.length, users });
    })();
  }

  if (p === "/api/users/add" && req.method === "POST") {
    return (async () => {
      const r = await requireRole(req, env, "manager"); if (r instanceof Response) return r;
      const body = await req.json();
      const email = String(body?.email || "").toLowerCase();
      if (!email) return json({ ok: false, error: "email_required" }, 400);
      const role = (body?.role || "student");
      const planTier = (body?.planTier || "free");
      const planDays = Number(body?.planDays || 0);
      const expires = planDays > 0 ? Date.now() + planDays * 86400000 : null;
      const u = await upsertUser(env, { email, role, planTier, planExpiresAt: expires, status: "active" });
      return json({ ok: true, user: u });
    })();
  }

  if (p === "/api/users/update" && req.method === "POST") {
    return (async () => {
      const r = await requireRole(req, env, "manager"); if (r instanceof Response) return r;
      const body = await req.json();
      const email = String(body?.email || "").toLowerCase();
      if (!email) return json({ ok: false, error: "email_required" }, 400);
      const u = await upsertUser(env, {
        email,
        role: body?.role,
        planTier: body?.planTier,
        planExpiresAt: (body?.planDays ? Date.now() + Number(body.planDays) * 86400000 : undefined),
        status: body?.status
      });
      return json({ ok: true, user: u });
    })();
  }

  if (p === "/api/users/delete" && req.method === "POST") {
    return (async () => {
      const r = await requireRole(req, env, "manager"); if (r instanceof Response) return r;
      const body = await req.json();
      const email = String(body?.email || "").toLowerCase();
      if (!email) return json({ ok: false, error: "email_required" }, 400);
      await deleteUser(env, email);
      return json({ ok: true });
    })();
  }

  // صفحه مدیریت (نیاز به manager به بالا)
  if (p === "/management") {
    return (async () => {
      const r = await requireRole(req, env, "manager"); if (r instanceof Response) return r;

      const body = `
        <style>
          table{width:100%; border-collapse: collapse}
          th,td{border:1px solid #eee; padding:6px}
          th{background:#fafafa}
          .row{display:flex; gap:8px; flex-wrap:wrap; align-items:end}
          input,select{padding:6px}
        </style>
        <h1>مدیریت کاربران</h1>
        <div class="card">
          <div class="row">
            <div><label>ایمیل</label><br><input id="email" placeholder="user@gmail.com" style="min-width:260px"></div>
            <div><label>نقش</label><br>
              <select id="role">
                <option value="student">student</option>
                <option value="manager">manager</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div><label>پلن</label><br>
              <select id="plan">
                <option value="free">free</option>
                <option value="pro1">pro1</option>
                <option value="pro2">pro2</option>
                <option value="pro3">pro3</option>
              </select>
            </div>
            <div><label>تمدید (روز)</label><br><input id="days" type="number" value="0" min="0" style="width:100px"></div>
            <button id="addBtn">افزودن/بروزرسانی</button>
          </div>
        </div>

        <div class="card" style="margin-top:10px">
          <b>لیست کاربران</b>
          <div id="meta" class="muted" style="margin:6px 0"></div>
          <table id="tb"><thead>
            <tr><th>#</th><th>Email</th><th>Role</th><th>Plan</th><th>Expiry</th><th>Status</th><th>عملیات</th></tr>
          </thead><tbody></tbody></table>
        </div>

        <script>
          async function load(){
            const r = await fetch('/api/users'); const d = await r.json();
            if (!d.ok) { alert('خطا در دریافت کاربران'); return; }
            document.getElementById('meta').textContent = 'تعداد: ' + d.total;
            const tb = document.querySelector('#tb tbody'); tb.innerHTML='';
            d.users.forEach((u, i) => {
              const tr = document.createElement('tr');
              const exp = u.planExpiresAt ? new Date(u.planExpiresAt).toLocaleString() : '-';
              tr.innerHTML = '<td>'+(i+1)+'</td><td>'+u.email+'</td><td>'+u.role+'</td><td>'+u.planTier+'</td><td>'+exp+'</td><td>'+u.status+'</td><td></td>';
              const ops = document.createElement('div');
              const upd = document.createElement('button'); upd.textContent='ویرایش';
              upd.onclick = async () => {
                const role = prompt('نقش (student/manager/admin):', u.role) || u.role;
                const plan = prompt('پلن (free/pro1/pro2/pro3):', u.planTier) || u.planTier;
                const days = prompt('تمدید روز (0=بدون تغییر):', '0') || '0';
                const res = await fetch('/api/users/update', { method:'POST', headers:{'content-type':'application/json'},
                  body: JSON.stringify({ email: u.email, role, planTier: plan, planDays: Number(days) })});
                const dd = await res.json(); if(!dd.ok) return alert('خطا'); load();
              };
              const del = document.createElement('button'); del.textContent='حذف';
              del.onclick = async () => {
                if (!confirm('حذف '+u.email+'?')) return;
                const res = await fetch('/api/users/delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email: u.email })});
                const dd = await res.json(); if(!dd.ok) return alert('خطا'); load();
              };
              ops.appendChild(upd); ops.appendChild(del);
              tr.lastChild.appendChild(ops);
              tb.appendChild(tr);
            });
          }
          document.getElementById('addBtn').addEventListener('click', async () => {
            const email = (document.getElementById('email') as HTMLInputElement).value.trim();
            const role  = (document.getElementById('role') as HTMLSelectElement).value;
            const plan  = (document.getElementById('plan') as HTMLSelectElement).value;
            const days  = Number((document.getElementById('days') as HTMLInputElement).value || '0');
            if (!email) return alert('ایمیل لازم است.');
            const r = await fetch('/api/users/add', { method:'POST', headers:{'content-type':'application/json'},
              body: JSON.stringify({ email, role, planTier: plan, planDays: days })});
            const d = await r.json(); if(!d.ok) return alert('خطا'); load();
          });
          // TypeScript castها داخل <script> مشکل ایجاد می‌کنند؛ جایگزین ساده:
          (document.getElementById('addBtn') as any);
          load();
        </script>
      `;
      return html(page("مدیریت کاربران", body));
    })();
  }

  return null;
}
