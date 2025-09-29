import { html, json, page } from "../lib/http";

export function routeAdmin(req: Request, url: URL): Response | null {
  if (url.pathname === "/api/admin/ping") {
    return json({ ok: true, role: "admin", ts: Date.now() });
  }

  if (url.pathname === "/admin") {
    const body = `
      <h1>پنل ادمین</h1>
      <div class="tabs">
        <a href="#konkur">ایجاد تست کنکور</a>
        <a href="#talifi">ایجاد تست تالیفی</a>
        <a href="#qa">ایجاد پرسش و پاسخ</a>
        <a href="#manage">ویرایش و حذف</a>
      </div>
      <div class="card"><b id="konkur">ایجاد تست کنکور</b><div class="muted">فرم‌ها بعدا وصل می‌شوند.</div></div>
      <div class="card"><b id="talifi">ایجاد تست تالیفی</b><div class="muted">اسکلت آماده است.</div></div>
      <div class="card"><b id="qa">ایجاد پرسش و پاسخ</b><div class="muted">بعدا به API وصل می‌کنیم.</div></div>
      <div class="card"><b id="manage">مدیریت سوالات</b><div class="muted">حذف از R2 هم در اینجا خواهد بود.</div></div>
      <p class="muted">API تست: <a href="/api/admin/ping">/api/admin/ping</a></p>
    `;
    return html(page("ادمین", body));
  }

  return null;
}
