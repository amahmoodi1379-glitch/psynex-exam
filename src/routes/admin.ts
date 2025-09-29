import { html, json, page } from "../lib/http";
import { createQuestion, listQuestions, deleteQuestion } from "../lib/dataStore";

export function routeAdmin(req: Request, url: URL, env?: any): Response | null {
  const p = url.pathname;

  // ایجاد آیتم برای هر سه نوع
  if (p === "/api/admin/create" && req.method === "POST") {
    return (async () => {
      const type = (url.searchParams.get("type") || "konkur") as "konkur"|"talifi"|"qa";
      const fd = await req.formData();
      const base = {
        type,
        majorId: String(fd.get("majorId") || ""),
        degreeId: fd.get("degreeId") ? String(fd.get("degreeId")) : undefined,
        ministryId: fd.get("ministryId") ? String(fd.get("ministryId")) : undefined,
        examYearId: fd.get("examYearId") ? String(fd.get("examYearId")) : undefined,
        courseId: String(fd.get("courseId") || ""),
        sourceId: fd.get("sourceId") ? String(fd.get("sourceId")) : undefined,
        chapterId: fd.get("chapterId") ? String(fd.get("chapterId")) : undefined,
        stem: String(fd.get("stem") || ""),
        expl: fd.get("expl") ? String(fd.get("expl")) : undefined
      } as any;

      if (type !== "qa") {
        base.options = [
          { label: "A", text: String(fd.get("optA") || "") },
          { label: "B", text: String(fd.get("optB") || "") },
          { label: "C", text: String(fd.get("optC") || "") },
          { label: "D", text: String(fd.get("optD") || "") }
        ];
        base.correctLabel = String(fd.get("correctLabel") || "A");
      }

      if (!env || !env.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      const id = await createQuestion(env, base);
      return json({ ok: true, id });
    })();
  }

  // لیست برای مدیریت
  if (p === "/api/admin/questions" && req.method === "GET") {
    return (async () => {
      const type = (url.searchParams.get("type") || "konkur") as "konkur"|"talifi"|"qa";
      if (!env || !env.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      const list = await listQuestions(env, type, 50);
      return json({ ok: true, data: list });
    })();
  }

  // حذف
  if (p === "/api/admin/question/delete" && req.method === "DELETE") {
    return (async () => {
      const type = (url.searchParams.get("type") || "konkur") as "konkur"|"talifi"|"qa";
      const id = String(url.searchParams.get("id") || "");
      if (!id) return json({ ok: false, error: "id required" }, 400);
      if (!env || !env.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      await deleteQuestion(env, type, id);
      // بعدا در اینجا حذف از R2 را هم اضافه می‌کنیم
      return json({ ok: true });
    })();
  }

  // صفحه ادمین با سه تب
  if (p === "/admin") {
    const body = `
      <h1>پنل ادمین</h1>
      <div class="tabs">
        <a href="#konkur">ایجاد تست کنکور</a>
        <a href="#talifi">ایجاد تست تالیفی</a>
        <a href="#qa">ایجاد پرسش و پاسخ</a>
        <a href="#manage">مدیریت سوالات</a>
      </div>

      <!-- تب کنکور -->
      <div class="card" id="tab-konkur">
        <b>ایجاد تست کنکور</b>
        ${formHtml("/api/admin/create?type=konkur", true)}
        <pre id="echo-konkur" class="muted"></pre>
      </div>

      <!-- تب تالیفی -->
      <div class="card" id="tab-talifi">
        <b>ایجاد تست تالیفی</b>
        ${formHtml("/api/admin/create?type=talifi", true)}
        <pre id="echo-talifi" class="muted"></pre>
      </div>

      <!-- تب پرسش و پاسخ -->
      <div class="card" id="tab-qa">
        <b>ایجاد پرسش و پاسخ</b>
        ${formHtml("/api/admin/create?type=qa", false)}
        <pre id="echo-qa" class="muted"></pre>
      </div>

      <!-- تب مدیریت -->
      <div class="card" id="tab-manage">
        <b>مدیریت سوالات</b>
        <div style="display:flex; gap:8px; align-items:center">
          <label>نوع:</label>
          <select id="m-type">
            <option value="konkur">کنکور</option>
            <option value="talifi">تالیفی</option>
            <option value="qa">پرسش و پاسخ</option>
          </select>
          <button id="m-load">بارگذاری</button>
        </div>
        <div style="margin-top:10px">
          <table border="1" cellpadding="6" style="width:100%; border-collapse:collapse">
            <thead><tr><th>شناسه</th><th>صورت سوال</th><th>عملیات</th></tr></thead>
            <tbody id="m-list"></tbody>
          </table>
        </div>
      </div>

      <script>
        // helper
        async function fillSelect(id, url, valueKey = "id", labelKey = "name") {
          const el = document.getElementById(id);
          el.innerHTML = "";
          const res = await fetch(url);
          const items = await res.json();
          for (const it of items) {
            const opt = document.createElement("option");
            opt.value = it[valueKey];
            opt.textContent = it[labelKey];
            el.appendChild(opt);
          }
        }
        async function initCascades(rootId) {
          await fillSelect(rootId+"-major", "/api/taxonomy/majors");
          await fillSelect(rootId+"-degree", "/api/taxonomy/degrees");
          await fillSelect(rootId+"-ministry", "/api/taxonomy/ministries");
          await fillSelect(rootId+"-examYear", "/api/taxonomy/exam-years");

          const upd = async () => {
            const majorId = document.getElementById(rootId+"-major").value;
            await fillSelect(rootId+"-course", "/api/taxonomy/courses?majorId=" + majorId);
            const courseId = document.getElementById(rootId+"-course").value;
            await fillSelect(rootId+"-source", "/api/taxonomy/sources?courseId=" + courseId);
            const sourceId = document.getElementById(rootId+"-source").value;
            await fillSelect(rootId+"-chapter", "/api/taxonomy/chapters?sourceId=" + sourceId);
          };
          document.getElementById(rootId+"-major").addEventListener("change", upd);
          document.getElementById(rootId+"-course").addEventListener("change", async () => {
            const courseId = document.getElementById(rootId+"-course").value;
            await fillSelect(rootId+"-source", "/api/taxonomy/sources?courseId=" + courseId);
          });
          document.getElementById(rootId+"-source").addEventListener("change", async () => {
            const sourceId = document.getElementById(rootId+"-source").value;
            await fillSelect(rootId+"-chapter", "/api/taxonomy/chapters?sourceId=" + sourceId);
          });
          await new Promise(r => setTimeout(r, 150));
          await upd();
        }
        function wireForm(formId, echoId) {
          const form = document.getElementById(formId);
          form.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const fd = new FormData(form);
            const res = await fetch(form.action, { method: "POST", body: fd });
            const data = await res.json();
            document.getElementById(echoId).textContent = JSON.stringify(data, null, 2);
            form.reset();
          });
        }
        function formRootId(action) {
          if (action.includes("konkur")) return "k";
          if (action.includes("talifi")) return "t";
          return "q";
        }
        // راه اندازی سه فرم
        initCascades("k"); wireForm("form-k", "echo-konkur");
        initCascades("t"); wireForm("form-t", "echo-talifi");
        initCascades("q"); wireForm("form-q", "echo-qa");

        // مدیریت
        document.getElementById("m-load").onclick = async () => {
          const type = document.getElementById("m-type").value;
          const res = await fetch("/api/admin/questions?type=" + type);
          const data = await res.json();
          const tb = document.getElementById("m-list");
          tb.innerHTML = "";
          if (!data.ok) { tb.innerHTML = "<tr><td colspan='3'>خطا</td></tr>"; return; }
          for (const it of data.data) {
            const tr = document.createElement("tr");
            tr.innerHTML = "<td>"+it.id+"</td><td>"+(it.stem?.slice(0,100) || "")+"</td><td></td>";
            const btn = document.createElement("button");
            btn.textContent = "حذف";
            btn.onclick = async () => {
              if (!confirm("حذف این آیتم؟")) return;
              await fetch("/api/admin/question/delete?type="+type+"&id="+encodeURIComponent(it.id), { method: "DELETE" });
              document.getElementById("m-load").click();
            };
            tr.lastChild.appendChild(btn);
            tb.appendChild(tr);
          }
        };
      </script>
    `;
    return html(page("ادمین", body));
  }

  return null;
}

// فرم HTML ساز
function formHtml(action: string, withOptions: boolean) {
  const root = action.includes("konkur") ? "k" : action.includes("talifi") ? "t" : "q";
  return `
  <form id="form-${root}" method="post" action="${action}">
    <div><label>رشته</label> <select id="${root}-major" name="majorId" required></select></div>
    <div><label>مقطع</label> <select id="${root}-degree" name="degreeId"></select></div>
    <div><label>وزارتخانه</label> <select id="${root}-ministry" name="ministryId"></select></div>
    <div><label>سال کنکور</label> <select id="${root}-examYear" name="examYearId"></select></div>
    <div><label>درس</label> <select id="${root}-course" name="courseId" required></select></div>
    <div><label>منبع</label> <select id="${root}-source" name="sourceId"></select></div>
    <div><label>فصل</label> <select id="${root}-chapter" name="chapterId"></select></div>

    <div><label>صورت سوال</label><br><textarea name="stem" required rows="3" style="width:100%"></textarea></div>
    ${withOptions ? `
      <div><label>گزینه A</label><input name="optA" required style="width:100%"></div>
      <div><label>گزینه B</label><input name="optB" required style="width:100%"></div>
      <div><label>گزینه C</label><input name="optC" required style="width:100%"></div>
      <div><label>گزینه D</label><input name="optD" required style="width:100%"></div>
      <div>
        <label>گزینه صحیح</label>
        <select name="correctLabel" required>
          <option value="A">A</option><option value="B">B</option>
          <option value="C">C</option><option value="D">D</option>
        </select>
      </div>` : ``}
    <div><label>پاسخنامه تشریحی</label><br><textarea name="expl" rows="3" style="width:100%"></textarea></div>
    <button type="submit">ثبت</button>
  </form>`;
}
