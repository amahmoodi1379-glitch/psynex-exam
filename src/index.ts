// src/index.ts
import { routeStudent } from "./routes/student";
import { routeAdmin } from "./routes/admin";        // فایل قبلی شما
import { routeAuth } from "./routes/auth";          // جدید
import { routeManagement } from "./routes/management"; // جدید
import { html } from "./lib/http";
import { getSessionUser, requireRole } from "./lib/auth";

export default {
  async fetch(req: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    // 1) auth endpoints
    const ra = routeAuth(req, url, env);
    if (ra) return ra;

    // 2) protect some paths upfront (non-GET taxonomy writes)
    if (p.startsWith("/api/taxonomy") && req.method !== "GET") {
      const guard = await requireRole(req, env, "admin");
      if (guard instanceof Response) return guard;
    }

    // 3) management (needs manager+)
    if (p === "/management" || p.startsWith("/api/users")) {
      const rm = routeManagement(req, url, env);
      if (rm) return rm;
    }

    // 4) admin (needs admin)
    if (p.startsWith("/admin") || p.startsWith("/api/admin")) {
      const guard = await requireRole(req, env, "admin");
      if (guard instanceof Response) return guard;
      const r = routeAdmin(req, url, env);
      if (r) return r;
    }

    // 5) student (open; ولی یوزر لاگین شده را در هدر نمایش می‌دهیم)
    const rs = routeStudent(req, url, env);
    if (rs) return rs;

    // 6) home
    const me = await getSessionUser(req, env);
    const body = `
      <h1>Psynex Exam</h1>
      <div class="card">
        ${me ? `
          <div>وارد شده با: <b>${me.email}</b> (${me.role}, ${me.planTier}) — <a href="/logout">خروج</a></div>
        ` : `
          <div><a href="/login"><button>ورود با گوگل</button></a></div>
        `}
        <ul>
          <li><a href="/student">صفحه دانشجو</a></li>
          <li><a href="/admin">صفحه ادمین</a> (نیاز به نقش admin)</li>
          <li><a href="/management">صفحه مدیریت کاربران</a> (نیاز به نقش manager/admin)</li>
        </ul>
      </div>
    `;
    return html(body);
  }
}
