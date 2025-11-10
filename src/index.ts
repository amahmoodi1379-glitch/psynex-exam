import { routeStudent } from "./routes/student";
import { routeAdmin } from "./routes/admin";
import { routeAuth } from "./routes/auth";
import { routeManagement } from "./routes/management";
import { routeTaxonomy } from "./routes/taxonomy";
import { html, page } from "./lib/http";
import { getSessionUser, requireRole } from "./lib/auth";
import { routeBilling } from "./routes/billing";

export default {
  async fetch(req: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    // 1) auth
    { const r = routeAuth(req, url, env); if (r) return r; }

    // 2) taxonomy (GET آزاد، نوشتن داخل taxonomy.ts قفل میشه)
    if (p.startsWith("/api/taxonomy") || p === "/admin/taxonomy") {
      const r = routeTaxonomy(req, url, env);
      if (r) return r;
    }

    // 3) billing APIs → نیاز به ورود
    if (p.startsWith("/api/billing")) {
      const guard = await requireRole(req, env, "student");
      if (guard instanceof Response) return guard;
      const r = await routeBilling(req, url, env, guard);
      if (r) return r;
    }

    // 4) student APIs → نیاز به ورود
    if (p.startsWith("/api/student")) {
      const guard = await requireRole(req, env, "student");
      if (guard instanceof Response) return guard;
      const r = routeStudent(req, url, env);
      if (r) return r;
    }

    // 5) مدیریت پرداخت (callback)
    if (p.startsWith("/billing/")) {
      const r = await routeBilling(req, url, env);
      if (r) return r;
    }

    // 6) management (manager+)
    if (p === "/management" || p.startsWith("/api/users")) {
      const r = routeManagement(req, url, env);
      if (r) return r;
    }

    // 7) admin (admin فقط)
    if (p.startsWith("/admin") || p.startsWith("/api/admin")) {
      const guard = await requireRole(req, env, "admin");
      if (guard instanceof Response) return guard;
      const r = routeAdmin(req, url, env);
      if (r) return r;
    }

    // 8) student page (نیاز به ورود)
    if (p === "/student") {
      const guard = await requireRole(req, env, "student");
      if (guard instanceof Response) return guard;
      const r = routeStudent(req, url, env);
      if (r) return r;
    }

    // 9) صفحه خانه (لینک‌های مدیریتی فقط برای نقش مجاز)
    const me = await getSessionUser(req, env);
    const body = `
      <div class="card">
        <h1>به Psynex Exam خوش آمدید</h1>
        ${me ? `
          <p>ورود: <b>${me.email}</b> (${me.role}, ${me.planTier}) — <a href="/logout">خروج</a></p>
        ` : `
          <p><a href="/login"><button>ورود</button></a></p>
        `}
        <ul>
          <li><a href="/student">صفحه دانشجو</a> (نیاز به ورود)</li>
          ${me && me.role === "manager" ? `<li><a href="/management">مدیریت کاربران</a></li>` : ``}
          ${me && (me.role === "admin" || me.role === "manager") ? `<li><a href="/admin">صفحه ادمین</a></li>` : ``}
        </ul>
      </div>
    `;
    return html(page("خانه", body));
  }
}
