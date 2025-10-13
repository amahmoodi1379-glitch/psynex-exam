// src/lib/billing.ts
import type { SessionPayload } from "./auth";

export const PLAN_CATALOG = {
  pro1: {
    title: "اشتراک ۱ ماهه",
    label: "ماهانه",
    months: 1,
    priceTomans: 249_000,
    description: "دسترسی کامل به بانک سؤال و ابزارهای تمرین به مدت یک ماه.",
    highlight: false,
  },
  pro2: {
    title: "اشتراک ۳ ماهه",
    label: "سه‌ماهه",
    months: 3,
    priceTomans: 699_000,
    description: "صرفه‌جویی نسبت به تمدید ماهانه و مناسب برای برنامه‌ریزی فصلی.",
    highlight: true,
  },
  pro3: {
    title: "اشتراک ۶ ماهه",
    label: "شش‌ماهه",
    months: 6,
    priceTomans: 1_199_000,
    description: "بیشترین صرفه‌جویی برای آمادگی بلندمدت و استفاده نامحدود.",
    highlight: false,
  },
} as const;

export type PlanTier = keyof typeof PLAN_CATALOG;
export type PlanDefinition = (typeof PLAN_CATALOG)[PlanTier];

export function getPlanDefinition(tier: string | null | undefined): (PlanDefinition & { tier: PlanTier }) | null {
  if (!tier) return null;
  const key = tier as PlanTier;
  if (!PLAN_CATALOG[key]) return null;
  return { tier: key, ...PLAN_CATALOG[key] };
}

export function monthsToMs(months: number): number {
  const daysPerMonth = 30;
  return months * daysPerMonth * 24 * 60 * 60 * 1000;
}

export type BillingRecord = {
  authority: string;
  email: string;
  planTier: PlanTier;
  months: number;
  amountTomans: number;
  amountRials: number;
  status: "pending" | "verified" | "failed";
  createdAt: number;
  callbackUrl: string;
  refId?: string;
  verifiedAt?: number;
  statusMessage?: string;
};

const TX_PREFIX = "billing:txn:";
const TX_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function txKey(authority: string) {
  return `${TX_PREFIX}${authority}`;
}

export async function saveBillingRequest(env: any, record: BillingRecord) {
  await env.DATA.put(txKey(record.authority), JSON.stringify(record), { expirationTtl: TX_TTL_SECONDS });
}

export async function getBillingRequest(env: any, authority: string): Promise<BillingRecord | null> {
  const raw = await env.DATA.get(txKey(authority));
  return raw ? JSON.parse(raw) as BillingRecord : null;
}

export async function updateBillingRequest(env: any, authority: string, patch: Partial<BillingRecord>): Promise<BillingRecord | null> {
  const current = await getBillingRequest(env, authority);
  if (!current) return null;
  const next: BillingRecord = { ...current, ...patch };
  await env.DATA.put(txKey(authority), JSON.stringify(next), { expirationTtl: TX_TTL_SECONDS });
  return next;
}

export function describePlanForSession(planTier: SessionPayload["planTier"]): string {
  const def = getPlanDefinition(planTier);
  return def ? def.title : "پلن رایگان";
}
