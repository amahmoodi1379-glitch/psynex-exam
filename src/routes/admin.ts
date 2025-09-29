import { html, json, page } from "../lib/http";

export function routeAdmin(req: Request, url: URL): Response | null {
  // API آزمایشی برای ارسال فرم
  if (url.pathname === "/api/admin/echo" && req.method === "POST") {
    return req.formData().then(fd => {
      const obj: Record<string, any> = {};
      fd.forEach((v, k) => (obj[k] = v));
      return json({ ok: true, received: obj });
    });
  }

  // صفحه ادمین با فرم آبشاری
  if (url.pathname === "/admin") {
    const body = `
      <h1>پنل ادمین</h1>
      <div class="tabs">
        <a href="#konkur">ایجاد تست کنکور</a>
        <a href="#talifi">ایجاد تست تالیفی</a>
        <a href="#qa">ایجاد پرسش و پاسخ</a>
        <a href="#manage">ویرایش و حذف</a>
      </div>

      <div class="card">
        <b id="konkur">ایجاد تست کنکور</b>
        <form id="konkurForm" method="post" action="/api/admin/echo">
          <div>
            <label>رشته</label>
            <select id="major" name="majorId" required></select>
          </div>
          <div>
            <label>مقطع</label>
            <select id="degree" name="degreeId" required></select>
          </div>
          <div>
            <label>وزارتخانه</label>
            <select id="ministry" name="ministryId" required></select>
          </div>
          <div>
            <label>سال کنکور</label>
            <select id="examYear" name="examYearId" required></select>
          </div>
          <div>
            <label>درس</label>
            <select id="course" name="courseId" required></select>
          </div>
          <div>
            <label>منبع</label>
            <select id="source" name="sourceId"></select>
          </div>
          <div>
            <label>فصل</label>
            <select id="chapter" name="chapterId"></select>
          </div>

          <div><label>صورت سوال</label><br><textarea name="stem" required rows="3" style="width:100%"></textarea></div>
          <div><label>گزینه A</label><input name="optA" required style="width:100%"></div>
          <div><label>گزینه B</label><input name="optB" required style="width:100%"></div>
          <div><label>گزینه C</label><input name="optC" required style="width:100%"></div>
          <div><label>گزینه D</label><input name="optD" required style="width:100%"></div>
          <div>
            <label>گزینه صحیح</label>
            <select name="correctLabel" required>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
            </select>
          </div>
          <div><label>پاسخنامه تشریحی</label><br><textarea name="expl" rows="3" style="width:100%"></textarea></div>

          <button type="submit">ثبت آزمایشی</button>
        </form>
        <pre id="echo" class="muted"></pre>
      </div>

      <script>
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

        // بارگذاری اولیه
        fillSelect("major", "/api/taxonomy/majors");
        fillSelect("degree", "/api/taxonomy/degrees");
        fillSelect("ministry", "/api/taxonomy/ministries");
        fillSelect("examYear", "/api/taxonomy/exam-years");

        // وابستگی‌ها
        document.getElementById("major").addEventListener("change", async (e) => {
          const majorId = e.target.value;
          await fillSelect("course", "/api/taxonomy/courses?majorId=" + majorId);
          const firstCourse = document.getElementById("course").value;
          await fillSelect("source", "/api/taxonomy/sources?courseId=" + firstCourse);
          const firstSource = document.getElementById("source").value;
          await fillSelect("chapter", "/api/taxonomy/chapters?sourceId=" + firstSource);
        });

        document.addEventListener("DOMContentLoaded", async () => {
          // پس از لود، اول courses را بر اساس اولین major پر کن
          const majorEl = document.getElementById("major");
          const updateAll = async () => {
            await fillSelect("course", "/api/taxonomy/courses?majorId=" + majorEl.value);
            await fillSelect("source", "/api/taxonomy/sources?courseId=" + document.getElementById("course").value);
            await fillSelect("chapter", "/api/taxonomy/chapters?sourceId=" + document.getElementById("source").value);
          };
          const wait = ms => new Promise(r => setTimeout(r, ms));
          // کمی صبر تا selects اولیه پر شوند
          await wait(200);
          await updateAll();
        });

        // ارسال فرم و نمایش پاسخ
        document.getElementById("konkurForm").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const fd = new FormData(ev.target);
          const res = await fetch(ev.target.action, { method: "POST", body: fd });
          const data = await res.json();
          document.getElementById("echo").textContent = JSON.stringify(data, null, 2);
        });
      </script>
    `;
    return html(page("ادمین", body));
  }

  return null;
}
