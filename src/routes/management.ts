import { html, json, page } from "../lib/http";
import { loadTaxonomy } from "../lib/taxonomyStore";

export function routeManagement(req: Request, url: URL, env: any): Response | null {
  if (url.pathname === "/api/management/ping") {
    return json({ ok: true, role: "manager", ts: Date.now() });
  }

  if (url.pathname === "/management") {
    const body = `
      <h1>مدیریت کاربران</h1>
      <div class="card">لیست کاربران، افزودن، ویرایش، حذف، تعیین پلن (بعدا).</div>
      <div class="card"><a href="/management/taxonomy">ویرایش تاکسونومی دراپ‌داون‌ها</a></div>
    `;
    return html(page("مدیریت", body));
  }

  if (url.pathname === "/management/taxonomy") {
    const body = `
      <h1>ویرایش تاکسونومی</h1>
      <p class="muted">برای ذخیره باید توکن مدیریتی را وارد کنی. این توکن را در Settings → Variables به نام ADMIN_TOKEN گذاشتی.</p>
      <div style="margin:8px 0">
        <label>توکن مدیریتی:</label>
        <input id="token" style="width:100%" placeholder="ADMIN_TOKEN">
      </div>
      <div>
        <textarea id="tx" rows="22" style="width:100%; direction:ltr"></textarea>
      </div>
      <div style="margin-top:8px">
        <button id="load">بارگذاری از سرور</button>
        <button id="save">ذخیره در سرور</button>
        <span id="msg" class="muted"></span>
      </div>
      <script>
        const $ = s => document.querySelector(s);
        $("#load").onclick = async () => {
          $("#msg").textContent = "در حال بارگذاری...";
          const token = $("#token").value.trim();
          const res = await fetch("/api/management/taxonomy?token=" + encodeURIComponent(token));
          const data = await res.json();
          if (data.ok) {
            $("#tx").value = JSON.stringify(data.data, null, 2);
            $("#msg").textContent = "آماده ویرایش.";
          } else {
            $("#msg").textContent = "خطا: " + (data.error || "unauthorized");
          }
        };
        $("#save").onclick = async () => {
          $("#msg").textContent = "در حال ذخیره...";
          try {
            const token = $("#token").value.trim();
            const parsed = JSON.parse($("#tx").value);
            const res = await fetch("/api/management/taxonomy", {
              method: "PUT",
              headers: { "content-type": "application/json", "x-admin-token": token },
              body: JSON.stringify(parsed)
            });
            const data = await res.json();
            $("#msg").textContent = data.ok ? "ذخیره شد." : "خطا در ذخیره.";
          } catch (e) {
            $("#msg").textContent = "JSON نامعتبر.";
          }
        };
      </script>
    `;
    return html(page("ویرایش تاکسونومی", body));
  }

  // نمونه: پر کردن اولیه در صورت نیاز (فقط خواندن)
  if (url.pathname === "/api/management/taxonomy-snapshot") {
    return (async () => json({ ok: true, data: await loadTaxonomy(env) }))();
  }

  return null;
}
