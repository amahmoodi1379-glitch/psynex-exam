import { html, json, page } from "../lib/http";
import {
  createQuestion,
  listQuestions,
  deleteQuestion,
  getQuestion,
  updateQuestion,
  findQuestionById,
  searchQuestionsByStem,
  type QuestionType,
  type Question,
} from "../lib/dataStore";

export function routeAdmin(req: Request, url: URL, env?: any): Response | null {
  const p = url.pathname;

  // ایجاد آیتم برای هر سه نوع
  if (p === "/api/admin/create" && req.method === "POST") {
    return (async () => {
      const type = (url.searchParams.get("type") || "konkur") as QuestionType;
      const fd = await req.formData();
      const payload = formToQuestionPayload(fd, type);
      if (!env || !env.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      const id = await createQuestion(env, payload);
      return json({ ok: true, id, type });
    })();
  }

  if (p === "/api/admin/question" && req.method === "GET") {
    return (async () => {
      const type = (url.searchParams.get("type") || "konkur") as QuestionType;
      const id = String(url.searchParams.get("id") || "");
      if (!id) return json({ ok: false, error: "id required" }, 400);
      if (!env || !env.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      const q = await getQuestion(env, type, id);
      if (!q) return json({ ok: false, error: "not_found" }, 404);
      return json({ ok: true, data: q });
    })();
  }

  if (p === "/api/admin/question/update" && req.method === "POST") {
    return (async () => {
      const type = (url.searchParams.get("type") || "konkur") as QuestionType;
      const fd = await req.formData();
      const id = String(url.searchParams.get("id") || fd.get("id") || "");
      if (!id) return json({ ok: false, error: "id required" }, 400);
      if (!env || !env.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      const payload = formToQuestionPayload(fd, type);
      const { type: _ignore, ...updates } = payload;
      const updated = await updateQuestion(env, type, id, updates);
      if (!updated) return json({ ok: false, error: "not_found" }, 404);
      return json({ ok: true, data: updated });
    })();
  }

  // لیست برای مدیریت
  if (p === "/api/admin/questions" && req.method === "GET") {
    return (async () => {
      const type = (url.searchParams.get("type") || "konkur") as "konkur"|"talifi"|"qa";
      const id = (url.searchParams.get("id") || "").trim();
      const query = (url.searchParams.get("query") || "").trim();
      if (!env || !env.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      let list: Question[];
      if (id) {
        list = await findQuestionById(env, type, id);
      } else if (query) {
        list = await searchQuestionsByStem(env, type, query, 200);
      } else {
        list = await listQuestions(env, type, 50);
      }
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
      return json({ ok: true });
    })();
  }

  // صفحه ادمین با تب‌های واقعی
  if (p === "/admin") {
    const body = `
      <style>
        .admin-root{padding-block:var(--s-4);}
        .admin-root h1{margin:0;}
        .tabbar{display:flex;flex-wrap:wrap;gap:var(--s-2);} 
        .tabbar .btn{background:#141826;border-color:var(--border);color:var(--text);} 
        .tabbar .btn.active{background:var(--primary);border-color:var(--primary);color:var(--primary-contrast);} 
        .tabsec{display:none;}
        .card.tabsec{gap:var(--s-3);} 
        .field{display:flex;flex-direction:column;gap:var(--s-1);font-size:14px;}
        .admin-form{display:grid;gap:var(--s-3);} 
        .options-grid{display:grid;gap:var(--s-3);} 
        .admin-search{display:flex;flex-wrap:wrap;gap:var(--s-2);align-items:flex-end;}
        .admin-search .field{flex:1 1 200px;}
        .admin-status{margin-top:var(--s-2);} 
        .admin-table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;} 
        .admin-table th,.admin-table td{padding:var(--s-2);border-bottom:1px solid var(--border);text-align:right;vertical-align:top;}
        .admin-table tbody tr:last-child td{border-bottom:none;}
        dialog{border:none;border-radius:var(--r-lg);padding:0;background:transparent;}
        dialog::backdrop{background:rgba(6,8,12,0.65);} 
        #edit-form{background:var(--surface);padding:var(--s-4);display:grid;gap:var(--s-3);border-radius:var(--r-lg);border:1px solid var(--border);} 
        #edit-options{display:grid;gap:var(--s-3);} 
        #edit-actions{display:flex;gap:var(--s-2);justify-content:flex-end;} 
      </style>

      <div class="container stack-4 admin-root">
        <h1>پنل ادمین</h1>
        <div class="card">
          <div class="tabbar">
            <button data-tab="tab-konkur" class="btn btn-ghost active">ایجاد تست کنکور</button>
            <button data-tab="tab-talifi" class="btn btn-ghost">ایجاد تست تالیفی</button>
            <button data-tab="tab-qa" class="btn btn-ghost">ایجاد پرسش و پاسخ</button>
            <button data-tab="tab-manage" class="btn btn-ghost">مدیریت سوالات</button>
            <a class="btn btn-ghost" href="/admin/taxonomy">مدیریت طبقه‌بندی</a>
          </div>
        </div>

        <!-- تب کنکور -->
        <div class="card tabsec stack-3" id="tab-konkur" style="display:block">
          <b>ایجاد تست کنکور</b>
          ${formHtml("/api/admin/create?type=konkur", true, "k")}
          <pre id="echo-konkur" class="muted"></pre>
        </div>

        <!-- تب تالیفی -->
        <div class="card tabsec stack-3" id="tab-talifi">
          <b>ایجاد تست تالیفی</b>
          ${formHtml("/api/admin/create?type=talifi", true, "t")}
          <pre id="echo-talifi" class="muted"></pre>
        </div>

        <!-- تب پرسش و پاسخ -->
        <div class="card tabsec stack-3" id="tab-qa">
          <b>ایجاد پرسش و پاسخ</b>
          ${formHtml("/api/admin/create?type=qa", false, "q")}
          <pre id="echo-qa" class="muted"></pre>
        </div>

        <!-- تب مدیریت -->
        <div class="card tabsec stack-3" id="tab-manage">
          <b>مدیریت سوالات</b>
          <form id="m-form" class="admin-search">
            <label class="field">نوع
              <select id="m-type" name="type" class="select">
                <option value="konkur">کنکور</option>
                <option value="talifi">تالیفی</option>
                <option value="qa">پرسش و پاسخ</option>
              </select>
            </label>
            <label class="field">شناسه (اختیاری)
              <input id="m-id" name="id" placeholder="UUID" class="input">
            </label>
            <label class="field">عبارت متن (اختیاری)
              <input id="m-query" name="query" placeholder="بخشی از صورت سوال" class="input">
            </label>
            <button type="submit" id="m-load" class="btn btn-primary">جست‌وجو</button>
          </form>
          <div id="m-status" class="muted admin-status"></div>
          <div class="stack-3">
            <table class="admin-table">
              <thead><tr><th>شناسه</th><th>صورت سوال</th><th>نوع</th><th>عملیات</th></tr></thead>
              <tbody id="m-list"></tbody>
            </table>
            <dialog id="edit-dialog">
              <form id="edit-form">
                <input type="hidden" name="id" id="edit-id">
                <input type="hidden" name="type" id="edit-type">
                <label class="field">رشته
                  <select id="edit-major" name="majorId" class="select" required></select>
                </label>
                <label class="field">مقطع
                  <select id="edit-degree" name="degreeId" class="select"></select>
                </label>
                <label class="field">وزارتخانه
                  <select id="edit-ministry" name="ministryId" class="select"></select>
                </label>
                <label class="field">سال کنکور
                  <select id="edit-examYear" name="examYearId" class="select"></select>
                </label>
                <label class="field">درس
                  <select id="edit-course" name="courseId" class="select" required></select>
                </label>
                <label class="field">منبع
                  <select id="edit-source" name="sourceId" class="select"></select>
                </label>
                <label class="field">فصل
                  <select id="edit-chapter" name="chapterId" class="select"></select>
                </label>
                <label class="field">صورت سوال
                  <textarea id="edit-stem" name="stem" class="input" required rows="3"></textarea>
                </label>
                <div id="edit-options">
                  <label class="field">گزینه 1
                    <input id="edit-opt1" name="opt1" class="input" required>
                  </label>
                  <label class="field">گزینه 2
                    <input id="edit-opt2" name="opt2" class="input" required>
                  </label>
                  <label class="field">گزینه 3
                    <input id="edit-opt3" name="opt3" class="input" required>
                  </label>
                  <label class="field">گزینه 4
                    <input id="edit-opt4" name="opt4" class="input" required>
                  </label>
                  <label class="field">گزینه صحیح
                    <select id="edit-correctLabel" name="correctLabel" class="select" required>
                      <option value="1">1</option><option value="2">2</option>
                      <option value="3">3</option><option value="4">4</option>
                    </select>
                  </label>
                </div>
                <label class="field">پاسخنامه تشریحی
                  <textarea id="edit-expl" name="expl" class="input" rows="3"></textarea>
                </label>
                <div id="edit-actions">
                  <button type="button" id="edit-cancel" class="btn btn-ghost">انصراف</button>
                  <button type="submit" class="btn btn-primary">ذخیره</button>
                </div>
              </form>
            </dialog>
          </div>
        </div>
      </div>
      
      <script>
        // تب‌ها
        const tabs = document.querySelectorAll('.tabbar button');
        function showTab(id){
          document.querySelectorAll('.tabsec').forEach(el=>el.style.display='none');
          document.getElementById(id).style.display='block';
          tabs.forEach(b=>b.classList.toggle('active', b.dataset.tab===id));
          location.hash = id;
        }
        tabs.forEach(b=>b.addEventListener('click', ()=>showTab(b.dataset.tab)));
        if (location.hash && document.getElementById(location.hash.slice(1))) showTab(location.hash.slice(1));

        // helpers
        function resetSelectOptions(el) {
          if (!(el instanceof HTMLSelectElement)) return;
          el.innerHTML = "";
          const placeholder = document.createElement("option");
          placeholder.value = "";
          placeholder.textContent = "یک گزینه را انتخاب کنید";
          placeholder.disabled = true;
          placeholder.selected = true;
          el.appendChild(placeholder);
        }
        async function fillSelect(id, url, valueKey = "id", labelKey = "name", selectedValue) {
          const el = document.getElementById(id);
          if (!(el instanceof HTMLSelectElement)) return;
          el.innerHTML = "";
          const res = await fetch(url);
          const items = await res.json();
          for (const it of items) {
            const opt = document.createElement("option");
            opt.value = it[valueKey];
            opt.textContent = it[labelKey];
            if (typeof selectedValue !== "undefined" && String(opt.value) === String(selectedValue)) {
              opt.selected = true;
            }
            el.appendChild(opt);
          }
          if (typeof selectedValue !== "undefined" && el.options.length) {
            const hasSelected = Array.from(el.options).some(o => o.selected);
            if (!hasSelected) {
              const placeholder = document.createElement("option");
              placeholder.value = "";
              placeholder.textContent = "یک گزینه را انتخاب کنید";
              placeholder.disabled = true;
              placeholder.selected = true;
              el.insertBefore(placeholder, el.firstChild);
            }
          }
        }
        async function initCascades(rootId) {
          await fillSelect(rootId+"-major", "/api/taxonomy/majors");
          await fillSelect(rootId+"-degree", "/api/taxonomy/degrees");
          await fillSelect(rootId+"-ministry", "/api/taxonomy/ministries");
          await fillSelect(rootId+"-examYear", "/api/taxonomy/exam-years");

          const majorEl = document.getElementById(rootId+"-major");
          const courseEl = document.getElementById(rootId+"-course");
          const sourceEl = (() => {
            const el = document.getElementById(rootId+"-source");
            return el instanceof HTMLSelectElement ? el : null;
          })();
          const chapterEl = (() => {
            const el = document.getElementById(rootId+"-chapter");
            return el instanceof HTMLSelectElement ? el : null;
          })();
          if (!(majorEl instanceof HTMLSelectElement) || !(courseEl instanceof HTMLSelectElement)) {
            return;
          }

          const updateChapters = async () => {
            if (!sourceEl || !chapterEl) return;
            const sourceId = sourceEl.value || "";
            if (!sourceId) {
              resetSelectOptions(chapterEl);
              return;
            }
            await fillSelect(rootId+"-chapter", "/api/taxonomy/chapters?sourceId=" + encodeURIComponent(sourceId));
          };

          const updateSources = async () => {
            if (!sourceEl) return;
            const courseId = courseEl.value || "";
            await fillSelect(rootId+"-source", "/api/taxonomy/sources?courseId=" + courseId);
            await updateChapters();
          };

          const updateCourses = async () => {
            const majorId = majorEl.value || "";
            await fillSelect(rootId+"-course", "/api/taxonomy/courses?majorId=" + majorId);
            await updateSources();
          };

          majorEl.addEventListener("change", updateCourses);
          courseEl.addEventListener("change", updateSources);
          sourceEl?.addEventListener("change", updateChapters);

          await new Promise(r => setTimeout(r, 120));
          await updateCourses();
        }
        function wireForm(formId, echoId) {
          const form = document.getElementById(formId);
          const echoEl = document.getElementById(echoId);
          const resettableSelectors = ["textarea", 'input:not([type="hidden"])', 'select[name="correctLabel"]'];
          if (!form || !echoEl) return;
          const resettableQuery = resettableSelectors.join(",");
          form.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const fd = new FormData(form);
            let data;
            try {
              const res = await fetch(form.action, { method: "POST", body: fd });
              data = await res.json();
            } catch (err) {
              echoEl.textContent = "خطا در برقراری ارتباط با سرور";
              return;
            }
            if (data && data.ok) {
              echoEl.textContent = "ثبت شد";
              form.querySelectorAll(resettableQuery).forEach((el) => {
                if (el instanceof HTMLSelectElement) {
                  el.selectedIndex = 0;
                  return;
                }
                if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                  el.value = "";
                }
              });
            } else {
              const message = data && data.error ? "خطا: " + data.error : "خطا در ثبت اطلاعات";
              echoEl.textContent = message;
            }
          });
        }

        // راه‌اندازی هر سه فرم
        initCascades("k"); wireForm("form-k", "echo-konkur");
        initCascades("t"); wireForm("form-t", "echo-talifi");
        initCascades("q"); wireForm("form-q", "echo-qa");
        initCascades("edit");

        const editDialog = document.getElementById("edit-dialog");
        const editForm = document.getElementById("edit-form");
        const editCancel = document.getElementById("edit-cancel");
        const editOptions = document.getElementById("edit-options");

        editCancel.addEventListener("click", () => {
          if (typeof editDialog.close === "function") editDialog.close();
          else editDialog.style.display = "none";
        });

        function toggleEditOptions(type) {
          const isQA = type === "qa";
          editOptions.style.display = isQA ? "none" : "block";
          editOptions.querySelectorAll("input, select").forEach(el => {
            if (el.tagName === "INPUT" || el.tagName === "SELECT") {
              el.required = !isQA;
            }
          });
        }

        async function populateEditTaxonomy(q) {
          await fillSelect("edit-major", "/api/taxonomy/majors", "id", "name", q.majorId);
          await fillSelect("edit-degree", "/api/taxonomy/degrees", "id", "name", q.degreeId);
          await fillSelect("edit-ministry", "/api/taxonomy/ministries", "id", "name", q.ministryId);
          await fillSelect("edit-examYear", "/api/taxonomy/exam-years", "id", "name", q.examYearId);

          const majorSel = document.getElementById("edit-major");
          const courseUrl = "/api/taxonomy/courses?majorId=" + encodeURIComponent(majorSel.value || q.majorId || "");
          await fillSelect("edit-course", courseUrl, "id", "name", q.courseId);

          const courseSel = document.getElementById("edit-course");
          const sourceUrl = "/api/taxonomy/sources?courseId=" + encodeURIComponent(courseSel.value || q.courseId || "");
          await fillSelect("edit-source", sourceUrl, "id", "name", q.sourceId);

          const sourceSel = document.getElementById("edit-source");
          const chapterUrl = "/api/taxonomy/chapters?sourceId=" + encodeURIComponent(sourceSel.value || q.sourceId || "");
          await fillSelect("edit-chapter", chapterUrl, "id", "name", q.chapterId);
        }

        async function openEdit(type, id) {
          const res = await fetch('/api/admin/question?type=' + type + '&id=' + encodeURIComponent(id));
          const data = await res.json();
          if (!data.ok) {
            alert(data.error || "خطا در دریافت اطلاعات سوال");
            return;
          }
          const q = data.data;
          document.getElementById("edit-id").value = q.id;
          document.getElementById("edit-type").value = q.type;
          document.getElementById("edit-stem").value = q.stem || "";
          document.getElementById("edit-expl").value = q.expl || "";

          await populateEditTaxonomy(q);
          toggleEditOptions(q.type);

          if (q.options && q.options.length) {
            const map = new Map(q.options.map(o => [o.label, o.text]));
            document.getElementById("edit-opt1").value = map.get("1") || "";
            document.getElementById("edit-opt2").value = map.get("2") || "";
            document.getElementById("edit-opt3").value = map.get("3") || "";
            document.getElementById("edit-opt4").value = map.get("4") || "";
          } else {
            document.getElementById("edit-opt1").value = "";
            document.getElementById("edit-opt2").value = "";
            document.getElementById("edit-opt3").value = "";
            document.getElementById("edit-opt4").value = "";
          }
          document.getElementById("edit-correctLabel").value = q.correctLabel || "1";

          if (typeof editDialog.showModal === "function") editDialog.showModal();
          else editDialog.style.display = "block";
        }

        editForm.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const fd = new FormData(editForm);
          const type = fd.get("type");
          const id = fd.get("id");
          if (!type || !id) {
            alert("نوع یا شناسه موجود نیست");
            return;
          }
          const res = await fetch('/api/admin/question/update?type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(id), {
            method: "POST",
            body: fd,
          });
          const data = await res.json();
          if (!data.ok) {
            alert(data.error || "ویرایش انجام نشد");
            return;
          }
          if (typeof editDialog.close === "function") editDialog.close();
          else editDialog.style.display = "none";
          loadManageList();
        });

        // مدیریت
        const manageForm = document.getElementById("m-form");
        const manageStatus = document.getElementById("m-status");
        async function loadManageList() {
          const type = document.getElementById("m-type").value;
          const id = document.getElementById("m-id").value.trim();
          const query = document.getElementById("m-query").value.trim();
          const params = new URLSearchParams({ type });
          if (id) params.set("id", id);
          if (query) params.set("query", query);
          manageStatus.textContent = "در حال جست‌وجو...";
          let data;
          try {
            const res = await fetch("/api/admin/questions?" + params.toString());
            data = await res.json();
          } catch (err) {
            manageStatus.textContent = "خطا در برقراری ارتباط";
            return;
          }
          const tb = document.getElementById("m-list");
          tb.innerHTML = "";
          if (!data.ok) {
            manageStatus.textContent = "خطا: " + (data.error || "نامشخص");
            return;
          }
          manageStatus.textContent = "";
          if (!Array.isArray(data.data) || data.data.length === 0) {
            manageStatus.textContent = "موردی یافت نشد";
            return;
          }
          for (const it of data.data) {
            const tr = document.createElement("tr");
            tr.innerHTML = "<td>"+it.id+"</td><td>"+(it.stem?.slice(0,120) || "")+"</td><td>"+it.type+"</td><td></td>";
            const actions = tr.lastChild;

            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.textContent = "ویرایش";
            editBtn.style.marginInlineEnd = "6px";
            editBtn.onclick = () => openEdit(it.type, it.id);
            actions.appendChild(editBtn);

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.textContent = "حذف";
            delBtn.onclick = async () => {
              if (!confirm("حذف این آیتم؟")) return;
              await fetch("/api/admin/question/delete?type="+type+"&id="+encodeURIComponent(it.id), { method: "DELETE" });
              loadManageList();
            };
            actions.appendChild(delBtn);
            tb.appendChild(tr);
          }
        }
        manageForm.addEventListener("submit", (ev) => {
          ev.preventDefault();
          loadManageList();
        });
      </script>
    `;
    return html(page("ادمین", body));
  }

  return null;
}

function optionalField(fd: FormData, key: string): string | undefined {
  const val = fd.get(key);
  if (val === null) return undefined;
  const str = String(val);
  return str ? str : undefined;
}

function formToQuestionPayload(fd: FormData, type: QuestionType): Omit<Question, "id"|"createdAt"> {
  const payload: Omit<Question, "id"|"createdAt"> = {
    type,
    majorId: String(fd.get("majorId") || ""),
    courseId: String(fd.get("courseId") || ""),
    stem: String(fd.get("stem") || ""),
  };

  if (type === "konkur") {
    payload.degreeId = optionalField(fd, "degreeId");
    payload.ministryId = optionalField(fd, "ministryId");
    payload.examYearId = optionalField(fd, "examYearId");
  }
  payload.sourceId = optionalField(fd, "sourceId");
  payload.chapterId = optionalField(fd, "chapterId");
  payload.expl = optionalField(fd, "expl");

  if (type !== "qa") {
    payload.options = [
      { label: "1", text: String(fd.get("opt1") || "") },
      { label: "2", text: String(fd.get("opt2") || "") },
      { label: "3", text: String(fd.get("opt3") || "") },
      { label: "4", text: String(fd.get("opt4") || "") },
    ];
    payload.correctLabel = String(fd.get("correctLabel") || "1") as Question["correctLabel"];
  }

  return payload;
}

// فرم‌ساز
function formHtml(action: string, withOptions: boolean, root: "k"|"t"|"q") {
  const konkurMeta = root === "k" ? `
    <label class="field">مقطع
      <select id="${root}-degree" name="degreeId" class="select"></select>
    </label>
    <label class="field">وزارتخانه
      <select id="${root}-ministry" name="ministryId" class="select"></select>
    </label>
    <label class="field">سال کنکور
      <select id="${root}-examYear" name="examYearId" class="select"></select>
    </label>
  ` : "";
  const optionalSourceChapter = root === "k" ? "" : `
    <label class="field">منبع
      <select id="${root}-source" name="sourceId" class="select"></select>
    </label>
    <label class="field">فصل
      <select id="${root}-chapter" name="chapterId" class="select"></select>
    </label>
  `;
  return `
  <form id="form-${root}" method="post" action="${action}" class="admin-form">
    <label class="field">رشته
      <select id="${root}-major" name="majorId" class="select" required></select>
    </label>
    ${konkurMeta}
    <label class="field">درس
      <select id="${root}-course" name="courseId" class="select" required></select>
    </label>
    ${optionalSourceChapter}

    <label class="field">صورت سوال
      <textarea name="stem" class="input" required rows="3"></textarea>
    </label>
    ${withOptions ? `
      <div class="options-grid">
        <label class="field">گزینه 1
          <input name="opt1" class="input" required>
        </label>
        <label class="field">گزینه 2
          <input name="opt2" class="input" required>
        </label>
        <label class="field">گزینه 3
          <input name="opt3" class="input" required>
        </label>
        <label class="field">گزینه 4
          <input name="opt4" class="input" required>
        </label>
        <label class="field">گزینه صحیح
          <select name="correctLabel" class="select" required>
            <option value="1">1</option><option value="2">2</option>
            <option value="3">3</option><option value="4">4</option>
          </select>
        </label>
      </div>` : ``}
    <label class="field">پاسخنامه تشریحی
      <textarea name="expl" class="input" rows="3"></textarea>
    </label>
    <button type="submit" class="btn btn-primary">ثبت</button>
  </form>`;
}

