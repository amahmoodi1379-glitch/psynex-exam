export type Item = { id: number | string; name: string; parentId?: number | string };
export type Taxonomy = {
  majors: Item[]; degrees: Item[]; ministries: Item[]; examYears: Item[];
  courses: Item[]; sources: Item[]; chapters: Item[];
};

const KEY = "taxonomy:v1";

const defaultTaxonomy: Taxonomy = {
  majors: [{ id: 1, name: "روانشناسی" }, { id: 2, name: "روانشناسی تربیتی" }, { id: 3, name: "کودکان استثنایی" }],
  degrees: [{ id: 1, name: "کارشناسی" }, { id: 2, name: "کارشناسی ارشد" }, { id: 3, name: "دکتری" }],
  ministries: [{ id: 1, name: "علوم" }, { id: 2, name: "بهداشت" }],
  examYears: [2020,2021,2022,2023,2024,2025].map((y,i)=>({ id:i+1, name:String(y) })),
  courses: [
    { id: 1, parentId: 1, name: "روانشناسی عمومی" },
    { id: 2, parentId: 1, name: "روانشناسی رشد" },
    { id: 3, parentId: 2, name: "یادگیری" },
    { id: 4, parentId: 2, name: "اندازه‌گیری و سنجش" },
    { id: 5, parentId: 3, name: "اختلالات تحولی" }
  ],
  sources: [
    { id: 1, parentId: 1, name: "موران و اللوی" },
    { id: 2, parentId: 2, name: "رشد لورابرک" },
    { id: 3, parentId: 3, name: "یادگیری هرگنهان" },
    { id: 4, parentId: 4, name: "سنجش گرتر" },
    { id: 5, parentId: 5, name: "منابع استثنایی" }
  ],
  chapters: [
    { id: 1, parentId: 1, name: "فصل 1" }, { id: 2, parentId: 1, name: "فصل 2" },
    { id: 3, parentId: 2, name: "فصل 1" }, { id: 4, parentId: 3, name: "فصل 1" },
    { id: 5, parentId: 4, name: "فصل 1" }, { id: 6, parentId: 5, name: "فصل 1" }
  ]
};

export async function loadTaxonomy(env: any): Promise<Taxonomy> {
  const raw = await env.TAXO.get(KEY);
  if (raw) return JSON.parse(raw);
  await env.TAXO.put(KEY, JSON.stringify(defaultTaxonomy));
  return defaultTaxonomy;
}
export async function saveTaxonomy(env: any, data: Taxonomy): Promise<void> {
  await env.TAXO.put(KEY, JSON.stringify(data));
}
