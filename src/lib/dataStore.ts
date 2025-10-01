export type Choice = { label: "A"|"B"|"C"|"D"; text: string };
export type QuestionType = "konkur" | "talifi" | "qa";

export type Question = {
  id: string;
  type: QuestionType;
  majorId: string;
  degreeId?: string;
  ministryId?: string;
  examYearId?: string;
  courseId: string;
  sourceId?: string;
  chapterId?: string;
  stem: string;
  options?: Choice[];        // برای qa خالی است
  correctLabel?: "A"|"B"|"C"|"D";
  expl?: string;
  createdAt: number;
};

const prefix = (t: QuestionType) => `q:${t}:`;

// ساخت آیتم
export async function createQuestion(env: any, q: Omit<Question, "id"|"createdAt">): Promise<string> {
  const id = crypto.randomUUID();
  const full: Question = { ...q, id, createdAt: Date.now() };
  await env.DATA.put(prefix(q.type) + id, JSON.stringify(full));
  return id;
}

// دریافت یکی
export async function getQuestion(env: any, type: QuestionType, id: string): Promise<Question | null> {
  const raw = await env.DATA.get(prefix(type) + id);
  return raw ? JSON.parse(raw) : null;
}

// لیست آخرین سوال‌ها
export async function listQuestions(env: any, type: QuestionType, limit = 50): Promise<Question[]> {
  const keys = await env.DATA.list({ prefix: prefix(type) });
  // ساده: آخرین ها بر اساس ایجاد به خاطر UUID مرتب نیستند، پس همین که آمدند را می‌گیریم
  const take = keys.keys.slice(-limit);
  const out: Question[] = [];
  for (const k of take.reverse()) {
    const raw = await env.DATA.get(k.name);
    if (raw) out.push(JSON.parse(raw));
  }
  return out;
}

// حذف
export async function deleteQuestion(env: any, type: QuestionType, id: string): Promise<boolean> {
  await env.DATA.delete(prefix(type) + id);
  return true;
}

export async function queryRandomQuestion(
  env: any,
  type: QuestionType,
  filters: Partial<Pick<Question, "majorId"|"degreeId"|"ministryId"|"examYearId"|"courseId"|"sourceId"|"chapterId">>,
  scanLimit = 300
): Promise<Question | null> {
  const { keys } = await env.DATA.list({ prefix: prefix(type), limit: scanLimit });
  const picks: Question[] = [];
  for (const k of keys) {
    const raw = await env.DATA.get(k.name);
    if (!raw) continue;
    const q: Question = JSON.parse(raw);
    if (filters.majorId && String(q.majorId) !== String(filters.majorId)) continue;
    if (filters.degreeId && String(q.degreeId || "") !== String(filters.degreeId)) continue;
    if (filters.ministryId && String(q.ministryId || "") !== String(filters.ministryId)) continue;
    if (filters.examYearId && String(q.examYearId || "") !== String(filters.examYearId)) continue;
    if (filters.courseId && String(q.courseId) !== String(filters.courseId)) continue;
    if (filters.sourceId && String(q.sourceId || "") !== String(filters.sourceId)) continue;
    if (filters.chapterId && String(q.chapterId || "") !== String(filters.chapterId)) continue;
    picks.push(q);
  }
  if (!picks.length) return null;
  return picks[Math.floor(Math.random() * picks.length)];
}

export type StudentAnswerLog = {
  clientId: string;
  qid: string;
  type: QuestionType;
  choice: "A"|"B"|"C"|"D";
  correct: boolean;
  at: number;
  filters?: Partial<Pick<Question, "majorId"|"degreeId"|"ministryId"|"examYearId"|"courseId"|"sourceId"|"chapterId">>;
};

const ansPrefix = (clientId: string) => `ans:${clientId}:`;     // کلیدهای پاسخ‌ها
const ratKey = (qid: string) => `rat:${qid}`;                   // تجمیع امتیازها

// ذخیره پاسخ دانشجو
export async function recordAnswer(env: any, log: StudentAnswerLog): Promise<void> {
  const key = ansPrefix(log.clientId) + String(log.at) + ":" + log.qid;
  await env.DATA.put(key, JSON.stringify(log));
}

// ثبت/تجمیع امتیاز کیفیت/سختی برای یک سؤال
export async function upsertRating(env: any, qid: string, quality?: number, difficulty?: number): Promise<void> {
  if (!quality && !difficulty) return;
  const raw = await env.DATA.get(ratKey(qid));
  const agg = raw ? JSON.parse(raw) : { qCount: 0, qSum: 0, dCount: 0, dSum: 0 };
  if (quality && quality >= 1 && quality <= 5) { agg.qCount++; agg.qSum += quality; }
  if (difficulty && difficulty >= 1 && difficulty <= 5) { agg.dCount++; agg.dSum += difficulty; }
  await env.DATA.put(ratKey(qid), JSON.stringify(agg));
}

// دریافت میانگین امتیاز یک سؤال (برای استفاده‌های بعدی)
export async function getRating(env: any, qid: string): Promise<{quality?: number, difficulty?: number}> {
  const raw = await env.DATA.get(ratKey(qid));
  if (!raw) return {};
  const a = JSON.parse(raw);
  return {
    quality: a.qCount ? a.qSum / a.qCount : undefined,
    difficulty: a.dCount ? a.dSum / a.dCount : undefined
  };
}

// -------- Challenges --------
export type ClientQStats = {
  qid: string;
  type: QuestionType;
  wrong: number;
  correct: number;
  lastAt: number;
};

// کلید شمارنده نمایش چالشی
const chlgKey = (clientId: string, qid: string) => `chlg:${clientId}:${qid}`;

// قبلی را با این نسخه "صفحه‌بندی‌شده" جایگزین کن
export async function listAnswersByClient(
  env: any,
  clientId: string,
  maxRead = 800 // حداکثر چند لاگ اخیر را بخوانیم (کافی است)
): Promise<StudentAnswerLog[]> {
  const prefix = `ans:${clientId}:`;
  let cursor: string | undefined = undefined;
  const allKeys: string[] = [];

  // KV.list حداکثر 1000 تا در هر درخواست می‌دهد؛ با cursor صفحه‌بندی می‌کنیم
  while (true) {
    const res = await env.DATA.list({ prefix, limit: 1000, cursor });
    for (const k of res.keys) allKeys.push(k.name);
    if (res.list_complete) break;
    if (allKeys.length >= maxRead * 2) break; // بیش از نیاز جمع نکنیم
    cursor = res.cursor;
  }

  // فقط آخرین maxRead کلید را بخوانیم (کاهش هزینه GET)
  const take = allKeys.slice(-maxRead);
  const out: StudentAnswerLog[] = [];
  for (let i = take.length - 1; i >= 0; i--) {
    const raw = await env.DATA.get(take[i]);
    if (raw) out.push(JSON.parse(raw));
  }
  return out;
}

// (اختیاری) اگر خواستی پنجرهٔ خواندن را کنترل‌پذیر کنی
export async function buildClientStats(
  env: any,
  clientId: string,
  maxRead = 800
): Promise<Map<string, ClientQStats>> {
  const logs = await listAnswersByClient(env, clientId, maxRead);
  const map = new Map<string, ClientQStats>();
  for (const lg of logs) {
    const key = `${lg.type}:${lg.qid}`;
    const cur = map.get(key) || { qid: lg.qid, type: lg.type, wrong: 0, correct: 0, lastAt: 0 };
    if (lg.correct) cur.correct += 1; else cur.wrong += 1;
    if (lg.at > cur.lastAt) cur.lastAt = lg.at;
    map.set(key, cur);
  }
  return map;
}


async function getServeCount(env: any, clientId: string, qid: string): Promise<number> {
  const raw = await env.DATA.get(chlgKey(clientId, qid));
  return raw ? Number(raw) || 0 : 0;
}
async function incServeCount(env: any, clientId: string, qid: string): Promise<void> {
  const n = (await getServeCount(env, clientId, qid)) + 1;
  await env.DATA.put(chlgKey(clientId, qid), String(n));
}

// انتخاب بهترین کاندید چالش با فیلترهای اختیاری
export async function chooseChallengeQuestion(
  env: any,
  clientId: string,
  filters: Partial<Pick<Question, "majorId"|"courseId"|"degreeId"|"ministryId"|"examYearId"|"sourceId"|"chapterId">> = {},
  typeFilter: QuestionType | null = null
): Promise<Question | null> {
  const stats = await buildClientStats(env, clientId);  // فقط سؤال‌هایی که قبلاً پاسخ داده شده‌اند
  const candidates: Array<{q: Question, st: ClientQStats, served: number}> = [];

  // برای هر سؤالِ دیده‌شده کاربر، اگر حداقل یک بار غلط داشته باشد و کمتر از 5 بار به‌عنوان چالش نشان داده شده باشد، بررسیش می‌کنیم
  for (const [key, st] of stats.entries()) {
    if (st.wrong <= 0) continue;
    const served = await getServeCount(env, clientId, st.qid);
    if (served >= 5) continue; // تا ۵ بار
    if (typeFilter && st.type !== typeFilter) continue;

    // سوال کامل را بگیر تا فیلترهای انتخابی را چک کنیم
    const q = await getQuestion(env, st.type, st.qid);
    if (!q) continue;

    // فیلترها (رشته اجباری در UI خواهد بود، بقیه اختیاری)
    const eq = (a?: string|number, b?: string|number) => (b == null || b === "" ? true : String(a||"") === String(b));
    if (!eq(q.majorId,     filters.majorId)) continue;
    if (!eq(q.courseId,    filters.courseId)) continue;
    if (!eq(q.degreeId,    filters.degreeId)) continue;
    if (!eq(q.ministryId,  filters.ministryId)) continue;
    if (!eq(q.examYearId,  filters.examYearId)) continue;
    if (!eq(q.sourceId,    filters.sourceId)) continue;
    if (!eq(q.chapterId,   filters.chapterId)) continue;

    candidates.push({ q, st, served });
  }

  if (!candidates.length) return null;

  // مرتب‌سازی: اول کمتر نمایش‌داده‌شده، بعد قدیمی‌تر (lastAt کوچکتر)، بعد بیشتر-غلط
  candidates.sort((a, b) => {
    if (a.served !== b.served) return a.served - b.served;
    if (a.st.lastAt !== b.st.lastAt) return a.st.lastAt - b.st.lastAt;
    return b.st.wrong - a.st.wrong;
  });

  const chosen = candidates[0];
  await incServeCount(env, clientId, chosen.q.id);
  return chosen.q;
}

// ---------- Stats (KV-based) ----------
export type StatsSummary = {
  total: number;
  correct: number;
  wrong: number;
  acc?: number; // accuracy %
  byType: {
    konkur: { total: number; correct: number; wrong: number; acc?: number };
    talifi: { total: number; correct: number; wrong: number; acc?: number };
    qa:      { total: number; correct: number; wrong: number; acc?: number };
  };
  series?: { bucketMs: number; start: number; points: Array<{ t: number; total: number; correct: number; wrong: number }> };
};

function msForWindow(win: string): number | null {
  const d = 24 * 60 * 60 * 1000;
  if (win === "24h") return d;
  if (win === "3d")  return 3 * d;
  if (win === "7d")  return 7 * d;
  if (win === "1m")  return 30 * d;
  if (win === "3m")  return 90 * d;
  if (win === "6m")  return 180 * d;
  if (win === "all") return null;
  return 7 * d; // پیش‌فرض
}

function addAcc(o: { total: number; correct: number; wrong: number }) {
  o.acc = o.total ? Math.round((o.correct / o.total) * 1000) / 10 : undefined;
}

export function aggregateStatsFromLogs(
  logs: StudentAnswerLog[],
  window: string,
  nowMs = Date.now(),
  desiredBuckets = 20
): StatsSummary {
  const wms = msForWindow(window);
  let filtered = logs;
  if (wms != null) {
    const start = nowMs - wms;
    filtered = logs.filter(l => l.at >= start);
  }

  const sum = { total: 0, correct: 0, wrong: 0 };
  const byType = {
    konkur: { total: 0, correct: 0, wrong: 0 },
    talifi: { total: 0, correct: 0, wrong: 0 },
    qa:     { total: 0, correct: 0, wrong: 0 },
  };

  for (const l of filtered) {
    sum.total++;
    if (l.correct) sum.correct++; else sum.wrong++;
    const bt = byType[l.type] || byType.qa;
    bt.total++;
    if (l.correct) bt.correct++; else bt.wrong++;
  }

  addAcc(sum);
  addAcc(byType.konkur);
  addAcc(byType.talifi);
  addAcc(byType.qa);

  // سری زمانی سبک (حداکثر ~20 باکت)
  let series: StatsSummary["series"] = undefined;
  let bucketMs = 0, start = 0;

  if (wms != null) {
    bucketMs = Math.max(Math.floor(wms / desiredBuckets), 60 * 60 * 1000); // حداقل 1h
    start = nowMs - wms;
  } else if (filtered.length) {
    // حالت all: بر اساس بازه‌ی واقعی لاگ‌ها
    const minAt = Math.min(...filtered.map(l => l.at));
    const span = Math.max(nowMs - minAt, 24 * 60 * 60 * 1000);
    bucketMs = Math.max(Math.floor(span / desiredBuckets), 60 * 60 * 1000);
    start = nowMs - span;
  }

  if (bucketMs > 0) {
    const buckets: Array<{ t: number; total: number; correct: number; wrong: number }> = [];
    const n = Math.ceil((nowMs - start) / bucketMs);
    for (let i = 0; i < n; i++) {
      buckets.push({ t: start + i * bucketMs, total: 0, correct: 0, wrong: 0 });
    }
    for (const l of filtered) {
      const idx = Math.floor((l.at - start) / bucketMs);
      if (idx >= 0 && idx < buckets.length) {
        const b = buckets[idx];
        b.total++;
        if (l.correct) b.correct++; else b.wrong++;
      }
    }
    series = { bucketMs, start, points: buckets };
  }

  return { total: sum.total, correct: sum.correct, wrong: sum.wrong, acc: sum.acc, byType, series };
}

// ---------- Exams (KV) ----------

export type ExamMode = "konkur" | "talifi" | "mixed";

export type ExamQuestionView = { id: string; type: QuestionType; stem: string; options: Choice[] };
export type ExamDraft = {
  id: string;
  clientId: string;
  mode: "konkur"; // فعلاً فقط کنکور
  filters: Partial<Pick<Question, "majorId"|"courseId">>;
  items: Array<{ id: string; type: QuestionType; correctLabel?: "A"|"B"|"C"|"D" }>;
  createdAt: number;
  durationSec: number;
};
export type ExamResult = {
  id: string;
  total: number;
  correct: number;
  wrong: number;
  blank: number;
  percentNoNeg: number;
  percentWithNeg: number;
  finishedAt: number;
};

const examKey = (clientId: string, examId: string) => `exam:${clientId}:${examId}`;
const examResKey = (clientId: string, examId: string) => `examres:${clientId}:${examId}`;

export function shuffle<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function sampleQuestions(
  env: any,
  type: QuestionType, // "konkur" | "talifi"
  filters: Partial<Pick<Question, "majorId"|"courseId"|"sourceId"|"chapterId">>,
  need: number,
  scanCap = 2000
): Promise<Question[]> {
  const prefixKey = `q:${type}:`;
  let cursor: string|undefined = undefined;
  const candidates: Question[] = [];
  while (true) {
    const res = await env.DATA.list({ prefix: prefixKey, limit: 1000, cursor });
    for (const k of res.keys) {
      const raw = await env.DATA.get(k.name);
      if (!raw) continue;
      const q: Question = JSON.parse(raw);
      if (filters.majorId   && String(q.majorId)   !== String(filters.majorId)) continue;
      if (filters.courseId  && String(q.courseId)  !== String(filters.courseId)) continue;
      if (filters.sourceId  && String(q.sourceId||"")  !== String(filters.sourceId)) continue;
      if (filters.chapterId && String(q.chapterId||"") !== String(filters.chapterId)) continue;
      candidates.push(q);
    }
    if (res.list_complete) break;
    if (candidates.length >= scanCap) break;
    cursor = res.cursor;
  }
  if (!candidates.length) return [];
  // شافل و بُرش
  return shuffle(candidates).slice(0, need);
}


export async function createExamDraft(
  env: any,
  clientId: string,
  mode: ExamMode, // "konkur" | "talifi" | "mixed"
  filters: Partial<Pick<Question, "majorId"|"courseId"|"sourceId"|"chapterId">>,
  count: number,
  durationSec: number
): Promise<{ id: string; questions: ExamQuestionView[]; durationSec: number }> {
  let picked: Question[] = [];

  if (mode === "konkur") {
    const kk = await sampleQuestions(env, "konkur", { majorId: filters.majorId, courseId: filters.courseId }, count);
    if (kk.length < 1) throw new Error("no_questions");
    picked = kk;

  } else if (mode === "talifi") {
    const tt = await sampleQuestions(env, "talifi", {
      majorId: filters.majorId, courseId: filters.courseId, sourceId: filters.sourceId, chapterId: filters.chapterId
    }, count);
    if (tt.length < 1) throw new Error("no_questions");
    picked = tt;

  } else { // mixed
    // نسبت کنکور 10%..60%
    const p = 0.10 + Math.random() * 0.50;
    let needK = Math.floor(count * p);
    needK = Math.max(1, Math.min(count-1, needK)); // هر دو نوع حاضر باشند

    const kPart = await sampleQuestions(env, "konkur", { majorId: filters.majorId, courseId: filters.courseId }, needK);
    const needT = count - kPart.length;
    const tPart = await sampleQuestions(env, "talifi", {
      majorId: filters.majorId, courseId: filters.courseId, sourceId: filters.sourceId, chapterId: filters.chapterId
    }, needT);

    if (kPart.length + tPart.length < 1) throw new Error("no_questions");
    // اگر کمتر از count شد، همان تعداد موجود را می‌گیریم (به‌جای ارور)
    picked = [...kPart, ...tPart].slice(0, count);
  }

  // ساخت پیش‌نویس
  const examId = crypto.randomUUID();
  const draft: ExamDraft = {
    id: examId,
    clientId,
    mode: mode === "mixed" ? "konkur" : mode, // برای سازگاری با type QuestionType هنگام grade (آیتم‌ها type خود را دارند)
    filters,
    items: picked.map(q => ({ id: q.id, type: q.type, correctLabel: q.correctLabel })),
    createdAt: Date.now(),
    durationSec
  };
  await env.DATA.put(examKey(clientId, examId), JSON.stringify(draft));

  const questions: ExamQuestionView[] = picked.map(q => ({
    id: q.id, type: q.type, stem: q.stem, options: (q.options || [])
  }));
  return { id: examId, questions, durationSec };
}


export async function gradeExam(
  env: any,
  clientId: string,
  examId: string,
  answers: Array<{ id: string; type: QuestionType; choice: "A"|"B"|"C"|"D"|null }>
): Promise<ExamResult> {
  const raw = await env.DATA.get(examKey(clientId, examId));
  if (!raw) throw new Error("exam_not_found");
  const draft: ExamDraft = JSON.parse(raw);

  let correct = 0, wrong = 0, blank = 0;
  const ansMap = new Map(answers.map(a => [a.id, a]));

  // نمره منفی 1/3
  const neg = 1/3;

  for (const it of draft.items) {
    const a = ansMap.get(it.id);
    if (!a || !a.choice) { blank++; continue; }
    if (it.correctLabel && a.choice === it.correctLabel) correct++; else wrong++;
  }
  const total = draft.items.length;
  const percentNoNeg = total ? Math.round((correct / total) * 1000)/10 : 0;
  const withNeg = Math.max(0, (correct - wrong * neg) / total);
  const percentWithNeg = Math.round(withNeg * 1000)/10;

  const res: ExamResult = {
    id: examId, total, correct, wrong, blank,
    percentNoNeg, percentWithNeg, finishedAt: Date.now()
  };
  await env.DATA.put(examResKey(clientId, examId), JSON.stringify(res));
  await saveExamSubmission(env, clientId, examId, answers);


  // ثبت در لاگ پاسخ‌ها برای آمار/چالش (استفاده از recordAnswer قبلاً تعریف شده)
  try {
    for (const it of draft.items) {
      const a = ansMap.get(it.id);
      const choice = (a && a.choice) ? a.choice : null;
      if (choice) {
        const q = await getQuestion(env, it.type as QuestionType, it.id);
        const isCorrect = !!q && q.correctLabel === choice;
        await recordAnswer(env, {
          clientId, qid: it.id, type: it.type as QuestionType,
          choice: choice as any, correct: isCorrect, at: Date.now(),
          filters: draft.filters
        });
      }
    }
  } catch { /* ignore */ }

  return res;
}

// -------- Exam submission & review (KV) --------
export type ExamAnswer = { id: string; type: QuestionType; choice: "A"|"B"|"C"|"D"|null };
export type ExamSubmission = { id: string; clientId: string; examId: string; answers: ExamAnswer[]; submittedAt: number };

const examAnsKey = (clientId: string, examId: string) => `examans:${clientId}:${examId}`;

export async function saveExamSubmission(env:any, clientId:string, examId:string, answers: ExamAnswer[]): Promise<void> {
  const sub: ExamSubmission = { id: examId, clientId, examId, answers, submittedAt: Date.now() };
  await env.DATA.put(examAnsKey(clientId, examId), JSON.stringify(sub));
}

export async function getExamReview(env:any, clientId:string, examId:string): Promise<Array<{
  id: string; type: QuestionType; stem: string; options: Choice[]; correctLabel?: "A"|"B"|"C"|"D";
  expl?: string | null; userChoice: "A"|"B"|"C"|"D"|null; isCorrect: boolean|null;
}>> {
  const raw = await env.DATA.get(examKey(clientId, examId));
  if (!raw) throw new Error("exam_not_found");
  const draft: ExamDraft = JSON.parse(raw);

  const ansRaw = await env.DATA.get(examAnsKey(clientId, examId));
  const answers: ExamAnswer[] = ansRaw ? (JSON.parse(ansRaw).answers || []) : [];
  const amap = new Map(answers.map(a => [a.id, a.choice]));

  const out: Array<{
    id: string; type: QuestionType; stem: string; options: Choice[]; correctLabel?: "A"|"B"|"C"|"D";
    expl?: string | null; userChoice: "A"|"B"|"C"|"D"|null; isCorrect: boolean|null;
  }> = [];

  for (const it of draft.items) {
    const q = await getQuestion(env, it.type as QuestionType, it.id);
    if (!q) continue;
    const choice = amap.get(it.id) ?? null;
    const isCorrect = choice ? (q.correctLabel === choice) : null;
    out.push({
      id: q.id, type: q.type, stem: q.stem, options: q.options || [],
      correctLabel: q.correctLabel, expl: q.expl || null,
      userChoice: choice, isCorrect
    });
  }
  return out;
}






