import { html, json, page } from "../lib/http";

export function routeManagement(req: Request, url: URL): Response | null {
  if (url.pathname === "/api/management/ping") {
    return json({ ok: true, role: "manager", ts: Date.now() });
  }

  if (url.pathname === "/management") {
    const body = `
      <h1>مدیریت کاربران</h1>
      <div class="card">لیست کاربران، افزودن، ویرایش، حذف، تعیین پلن.</div>
      <p class="muted">API تست: <a href="/api/management/ping">/api/management/ping</a></p>
    `;
    return html(page("مدیریت", body));
  }

  return null;
}
