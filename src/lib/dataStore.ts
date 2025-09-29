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

