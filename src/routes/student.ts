import { html, json, page } from "../lib/http";

export function routeStudent(req: Request, url: URL): Response | null {
  if (url.pathname === "/api/student/ping") {
    return json({ ok: true, role: "student", ts: Date.now() });
  }

  if (url.pathname === "/student") {
    const body = `
      <h1>صفحه دانشجو</h1>
      <div class="tabs">
        <a href="#single">تک سوال‌ها</a>
        <a href="#exams">آزمون‌ها</a>
        <a href="#stats">آمار</a>
        <a href="#challenges">چالش‌ها</a>
      </div>
      <div class="card"><b id="single">تک سوال‌ها</b><div class="muted">در مراحل بعد به انتخاب وزن‌دار وصل می‌شود.</div></div>
      <div class="card"><b id="exams">آزمون‌ها</b><div class="muted">سه مود: کنکور، ترکیبی، تالیفی.</div></div>
      <div class="card"><b id="stats">آمار</b><div class="muted">نمایش بازه‌های 24h, 3d, 7d, 1m, 3m, 6m, all.</div></div>
      <div class="card"><b id="challenges">چالش‌ها</b><div class="muted">Spaced repetition ساده.</div></div>
      <p class="muted">API تست: <a href="/api/student/ping">/api/student/ping</a></p>
    `;
    return html(page("دانشجو", body));
  }

  return null;
}
