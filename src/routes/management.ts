import { html, json, page } from "../lib/http";
import { loadTaxonomy } from "../lib/taxonomyStore";

export function routeManagement(req: Request, url: URL, env: any): Response | null {
  const p = url.pathname;

  if (p === "/api/management/ping") {
    return json({ ok: true, role: "manager", ts: Date.now() });
  }

  if (p === "/management") {
    const body = `
      <h1>مدیریت کاربران</h1>
      <div class="card">لیست کاربران، افزودن، ویرایش، حذف، تعیین پلن (بعدا).</div>
      <div class="card"><a href="/management/taxonomy">ویرایش تاکسونومی دراپ‌داون‌ها</a></div>
    `;
    return html(page("مدیریت", body));
  }

  if (p === "/management/taxonomy" || p === "/management/taxonomy/") {
    const body = `
      <h1>ویرایش تاکسونومی</h1>
      <p class="muted">برای ذخیره باید توکن مدیریتی را وارد کنی. این توکن را در Settings → Variables به نام ADMIN_TOKEN گذاشتی.</p>
      <div style="margin:8px 0">
        <label>توکن مدیریتی:</label>
        <input id="token" style="width:100%" placeholder="ADMIN_TOKEN">
      </div>

      <div class="card">
        <b>ویرایش ساده</b>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
          <label>نوع موجودیت:</label>
          <select id="entity">
            <option value="majors">رشته</option>
            <option value="degrees">مقطع</option>
            <option value="ministries">وزارتخانه</option>
            <option value="exam-years">سال کنکور</option>
            <option value="courses">درس</option>
            <option value="sources">منبع</option>
            <option value="chapters">فصل</option>
          </select>

          <span id="parentMajorWrap" style="display:none">
            <label>رشته والد:</label>
            <select id="parentMajor"></select>
          </span>

          <span id="parentCourseWrap" style="display:none">
            <label>درس والد:</label>
            <select id="parentCourse"></select>
          </span>

          <span id="parentSourceWrap" style="display:none">
            <label>منبع والد:</label>
            <select id="parentSource"></select>
          </span>
        </div>

        <div style="margin-top:8px">
          <input id="itemId" type="hidden">
          <input id="itemName" placeholder="نام آیتم" style="width:60%">
          <button id="addBtn">افزودن یا ویرایش</button>
        </div>

        <div style="margin-top:12px">
          <table border="1" cellpadding="6" style="width:100%; border-collapse:collapse">
            <thead><tr><th style="width:60%">نام</th><th>شناسه</th><th>عملیات</th></tr></thead>
            <tbody id="list"></tbody>
          </table>
        </div>
        <div class="muted" id="note"></div>
      </div>

      <div class="card">
        <b>ویرایش پیشرفته JSON</b>
        <div>
          <textarea id="tx" rows="18" style="width:100%; direction:ltr"></textarea>
        </div>
        <div style="margin-top:8px">
          <button id="load">بارگذاری از سرور</button>
          <button id="save">ذخیره در سرور</button>
          <span id="msg" class="muted"></span>
        </div>
      </div>

      <script>
        const $ = s => document.querySelector(s);
        let T = null;

        function entityKey(e) { return e; }
        function showParents(e) {
          $("#parentMajorWrap").style.display = (e === "courses") ? "inline-block" : "none";
          $("#parentCourseWrap").style.display = (e === "sources") ? "inline-block" : "none";
          $("#parentSourceWrap").style.display = (e === "chapters") ? "inline-block" : "none";
        }
        function fill(sel, items) {
          sel.innerHTML = "";
          for (const it of items) {
            const o = document.createElement("option");
            o.value = it.id; o.textContent = it.name;
            sel.appendChild(o);
          }
        }
        function renderList() {
          const e = $("#entity").value;
          const tbody = $("#list");
          tbody.innerHTML = "";
          let items = [];
          if (!T) return;

          if (e === "majors") items = T.majors;
          if (e === "degrees") items = T.degrees;
          if (e === "ministries") items = T.ministries;
          if (e === "exam-years") items = T.examYears;
          if (e === "courses") {
            const pm = $("#parentMajor").value;
            items = T.courses.filter(x => String(x.parentId) === String(pm));
          }
          if (e === "sources") {
            const pc = $("#parentCourse").value;
            items = T.sources.filter(x => String(x.parentId) === String(pc));
          }
          if (e === "chapters") {
            const ps = $("#parentSource").value;
            items = T.chapters.filter(x => String(x.parentId) === String(ps));
          }

          for (const it of items) {
            const tr = document.createElement("tr");
            const tdName = document.createElement("td");
            tdName.textContent = it.name;
            tdName.style.cursor = "pointer";
            tdName.title = "برای ویرایش کلیک کن";
            tdName.onclick = () => { $("#itemId").value = it.id; $("#itemName").value = it.name; };
            const tdId = document.createElement("td");
            tdId.textContent = it.id;
            const tdAct = document.createElement("td");
            const del = document.createElement("button");
            del.textContent = "حذف";
            del.onclick = () => doDelete(e, it.id);
            tdAct.appendChild(del);
            tr.appendChild(tdName); tr.appendChild(tdId); tr.appendChild(tdAct);
            tbody.appendChild(tr);
          }
          $("#note").textContent = items.length ? "" : "موردی برای نمایش نیست.";
        }

        async function fetchT() {
          const token = $("#token").value.trim();
          const r = await fetch("/api/management/taxonomy?token=" + encodeURIComponent(token));
          const d = await r.json();
          if (!d.ok) throw new Error(d.error || "unauthorized");
          T = d.data;
          $("#tx").value = JSON.stringify(T, null, 2);
          fill($("#parentMajor"), T.majors);
          fill($("#parentCourse"), T.courses);
          fill($("#parentSource"), T.sources);
          renderList();
        }

        async function doUpsert() {
          const token = $("#token").value.trim();
          const e = $("#entity").value;
          const body = { id: $("#itemId").value || undefined, name: $("#itemName").value };
          if (e === "courses") body.parentId = $("#parentMajor").value;
          if (e === "sources") body.parentId = $("#parentCourse").value;
          if (e === "chapters") body.parentId = $("#parentSource").value;

          const r = await fetch("/api/management/taxonomy/upsert?entity=" + e, {
            method: "POST",
            headers: { "content-type": "application/json", "x-admin-token": token },
            body: JSON.stringify(body)
          });
          const d = await r.json();
          if (!d.ok) throw new Error(d.error || "upsert failed");
          await fetchT();
          $("#itemId").value = ""; $("#itemName").value = "";
        }

        async function doDelete(e, id) {
          const token = $("#token").value.trim();
          if (!confirm("حذف شود؟ عملیات آبشاری ممکن است آیتم‌های زیرمجموعه را هم حذف کند.")) return;
          const r = await fetch("/api/management/taxonomy/delete?entity=" + e + "&id=" + encodeURIComponent(id), {
            method: "DELETE",
            headers: { "x-admin-token": token }
          });
          const d = await r.json();
          if (!d.ok) { alert("خطا در حذف"); return; }
          await fetchT();
        }

        // رویدادها
        $("#entity").addEventListener("change", () => { showParents($("#entity").value); renderList(); });
        $("#parentMajor").addEventListener("change", renderList);
        $("#parentCourse").addEventListener("change", renderList);
        $("#parentSource").addEventListener("change", renderList);
        $("#addBtn").addEventListener("click", async () => { try { await doUpsert(); } catch(e){ alert(e.message); } });

        // بخش JSON پیشرفته
        $("#load").onclick = async () => {
          $("#msg").textContent = "در حال بارگذاری...";
          try { await fetchT(); $("#msg").textContent = "آماده ویرایش."; } catch(e){ $("#msg").textContent = "خطا: " + e.message; }
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
            if (data.ok) { T = parsed; renderList(); }
          } catch (e) { $("#msg").textContent = "JSON نامعتبر."; }
        };

        // حالت اولیه
        showParents($("#entity").value);
      </script>
    `;
    return html(page("ویرایش تاکسونومی", body));
  }

  if (p === "/api/management/taxonomy-snapshot") {
    return (async () => json({ ok: true, data: await loadTaxonomy(env) }))();
  }

  return null;
}
