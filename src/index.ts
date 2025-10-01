// src/index.ts
import { routeStudent } from "./routes/student";
import { routeAdmin } from "./routes/admin";
import { routeAuth } from "./routes/auth";              // ← نسخه محلی (بدون گوگل)
import { routeManagement } from "./routes/management";
import { html } from "./lib/http";
import { getSessionUser, requireRole } from "./lib/auth";

export default {
  async fetch(req: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    // 1) auth endpoints (login/signup/logout/me)
    const ra = routeAuth(req, url, env);
    if (ra) return ra;

    // 2) قفل نوشتن تاکسونومی برای admin
    if (p.startsWith("/api/taxonomy") && req.method !== "GET") {
      const guard = await requireRole(req, env, "admin");
      if (guard instanceof Response) return guard;
    }

    // 3) قفل APIهای دانشجو برای کاربر لاگین
    if (p.startsWith("/api/student")) {
      const guard = await requireRole(req, env, "student");
      if (guard instanceof Response) return guard;
    }

    // 4) management (manager+)
    if (p === "/management" || p.startsWith("/api/users")) {
      const rm = routeManagement(req, url, env);
      if (rm) return rm;
    }

    // 5) admin (admin فقط)
    if (p.startsWith("/admin") || p.startsWith("/api/admin")) {
      const guard = await requireRole(req, env, "admin");
      if (guard instanceof Response) return guard;
      const r = routeAdmin(req, url, env);
      if (r) return r;
    }

    // 6) student page (نیاز به لاگین)
    if (p === "/student") {
      const guard = await requireRole(req, env, "student");
      if (guard instanceof Response) return guard;
      const rs = routeStudent(req, url, env);
      if (rs) return rs;
    }

    // 7) صفحه خانه
    const me = await getSessionUser(req, env);
    const body = `
      <h1>Psynex Exam</h1>
      <div class="card">
        ${me ? `
          <div>ورود: <b>${me.email}</b> (${me.role}, ${me.planTier}) — <a href="/logout">خروج</a></div>
        ` : `
          <div><a href="/login"><button>ورود</button></a> یا <a href="/signup"><button>ثبت‌نام</button></a></div>
        `}
        <ul>
          <li><a href="/student">صفحه دانشجو</a> (نیاز به ورود)</li>
          <li><a href="/admin">صفحه ادمین</a> (admin)</li>
          <li><a href="/management">صفحه مدیریت کاربران</a> (manager/admin)</li>
        </ul>
      </div>
    `;
    return html(body);
  }
}
