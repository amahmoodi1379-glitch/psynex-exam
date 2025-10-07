import { routeStudent } from "./routes/student";
import { routeAdmin } from "./routes/admin";
import { routeAuth } from "./routes/auth";
import { routeManagement } from "./routes/management";
import { routeTaxonomy } from "./routes/taxonomy";
import { html } from "./lib/http";
import { getSessionUser, requireRole } from "./lib/auth";
import { enforceRateLimit } from "./lib/rateLimit";
export { RateLimiterDO } from "./rateLimiterDO";

export default {
  async fetch(req: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    if (req.method !== "OPTIONS") {
      const rateResponse = await enforceRateLimit(req, env);
      if (rateResponse) return rateResponse;
    }

    // 1) auth
    { const r = routeAuth(req, url, env); if (r) return r; }

    // 2) taxonomy (GET آزاد، نوشتن داخل taxonomy.ts قفل میشه)
    if (p.startsWith("/api/taxonomy") || p === "/admin/taxonomy") {
      const r = routeTaxonomy(req, url, env);
      if (r) return r;
    }

    // 3) student APIs → نیاز به ورود
    if (p.startsWith("/api/student")) {
      const guard = await requireRole(req, env, "student");
      if (guard instanceof Response) return guard;
      const r = routeStudent(req, url, env);
      if (r) return r;
    }

    // 4) management (manager+)
    if (p === "/management" || p.startsWith("/api/users")) {
      const r = routeManagement(req, url, env);
      if (r) return r;
    }

    // 5) admin (admin فقط)
    if (p.startsWith("/admin") || p.startsWith("/api/admin")) {
      const guard = await requireRole(req, env, "admin");
      if (guard instanceof Response) return guard;
      const r = routeAdmin(req, url, env);
      if (r) return r;
    }

    // 6) student page (نیاز به ورود)
    if (p === "/student") {
      const guard = await requireRole(req, env, "student");
      if (guard instanceof Response) return guard;
      const r = routeStudent(req, url, env);
      if (r) return r;
    }

    // 7) صفحه خانه (لینک‌های مدیریتی فقط برای نقش مجاز)
    const me = await getSessionUser(req, env);
    const body = `
      <h1>Psynex Exam</h1>
      <div class="card">
        ${me ? `
          <div>ورود: <b>${me.email}</b> (${me.role}, ${me.planTier}) — <a href="/logout">خروج</a></div>
        ` : `
          <div><a href="/login"><button>ورود</button></a></div>
        `}
        <ul>
          <li><a href="/student">صفحه دانشجو</a> (نیاز به ورود)</li>
          ${me && (me.role === "manager" || me.role === "admin") ? `<li><a href="/management">مدیریت کاربران</a></li>` : ``}
          ${me && me.role === "admin" ? `<li><a href="/admin">صفحه ادمین</a></li>` : ``}
        </ul>
      </div>
    `;
    return html(body);
  }
}
