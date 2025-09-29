import { json } from "../lib/http";

type Item = { id: number; name: string; parentId?: number };

// داده نمونه برای شروع. بعدا از D1 می‌آید.
const majors: Item[] = [
  { id: 1, name: "روانشناسی" },
  { id: 2, name: "روانشناسی تربیتی" },
  { id: 3, name: "کودکان استثنایی" }
];

const degrees: Item[] = [
  { id: 1, name: "کارشناسی" },
  { id: 2, name: "کارشناسی ارشد" },
  { id: 3, name: "دکتری" }
];

const ministries: Item[] = [
  { id: 1, name: "علوم" },
  { id: 2, name: "بهداشت" }
];

const examYears: Item[] = [2020, 2021, 2022, 2023, 2024, 2025].map((y, i) => ({ id: i + 1, name: String(y) }));

const courses: Item[] = [
  { id: 1, parentId: 1, name: "روانشناسی عمومی" },
  { id: 2, parentId: 1, name: "روانشناسی رشد" },
  { id: 3, parentId: 2, name: "یادگیری" },
  { id: 4, parentId: 2, name: "اندازه‌گیری و سنجش" },
  { id: 5, parentId: 3, name: "اختلالات تحولی" }
];

const sources: Item[] = [
  { id: 1, parentId: 1, name: "موران و اللوی" },
  { id: 2, parentId: 2, name: "رشد لورابرک" },
  { id: 3, parentId: 3, name: "یادگیری هرگنهان" },
  { id: 4, parentId: 4, name: "سنجش گرتر" },
  { id: 5, parentId: 5, name: "منابع استثنایی" }
];

const chapters: Item[] = [
  { id: 1, parentId: 1, name: "فصل 1" },
  { id: 2, parentId: 1, name: "فصل 2" },
  { id: 3, parentId: 2, name: "فصل 1" },
  { id: 4, parentId: 3, name: "فصل 1" },
  { id: 5, parentId: 4, name: "فصل 1" },
  { id: 6, parentId: 5, name: "فصل 1" }
];

export function routeTaxonomy(_req: Request, url: URL): Response | null {
  // /api/taxonomy/majors
  if (url.pathname === "/api/taxonomy/majors") return json(majors);

  // /api/taxonomy/degrees
  if (url.pathname === "/api/taxonomy/degrees") return json(degrees);

  // /api/taxonomy/ministries
  if (url.pathname === "/api/taxonomy/ministries") return json(ministries);

  // /api/taxonomy/exam-years
  if (url.pathname === "/api/taxonomy/exam-years") return json(examYears);

  // /api/taxonomy/courses?majorId=1
  if (url.pathname === "/api/taxonomy/courses") {
    const majorId = Number(url.searchParams.get("majorId"));
    return json(courses.filter(c => !majorId || c.parentId === majorId));
  }

  // /api/taxonomy/sources?courseId=1
  if (url.pathname === "/api/taxonomy/sources") {
    const courseId = Number(url.searchParams.get("courseId"));
    return json(sources.filter(s => !courseId || s.parentId === courseId));
  }

  // /api/taxonomy/chapters?sourceId=1
  if (url.pathname === "/api/taxonomy/chapters") {
    const sourceId = Number(url.searchParams.get("sourceId"));
    return json(chapters.filter(ch => !sourceId || ch.parentId === sourceId));
  }

  return null;
}
