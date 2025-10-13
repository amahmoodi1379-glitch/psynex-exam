// src/routes/billing.ts
import { html, json, page } from "../lib/http";
import { getSessionUser, signJWT } from "../lib/auth";
import { getUserByEmail, upsertUser } from "../lib/users";
import {
  PLAN_CATALOG,
  getPlanDefinition,
  monthsToMs,
  saveBillingRequest,
  getBillingRequest,
  updateBillingRequest,
  type PlanTier,
} from "../lib/billing";

const MERCHANT_ID = "27dfac21-23c3-4da7-b5d1-4d0ac3e6a65b";

function paymentRequestBody(planTier: PlanTier, amountRials: number, callbackUrl: string, email: string) {
  const def = PLAN_CATALOG[planTier];
  return {
    merchant_id: MERCHANT_ID,
    amount: amountRials,
    callback_url: callbackUrl,
    description: `پرداخت اشتراک ${def.title}`,
    metadata: {
      email,
    },
  };
}

function buildPaymentUrl(authority: string): string {
  return `https://www.zarinpal.com/pg/StartPay/${authority}`;
}

function formatDateFa(ts: number | null | undefined) {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleDateString("fa-IR");
  }
}

export async function routeBilling(req: Request, url: URL, env?: any, session?: Awaited<ReturnType<typeof getSessionUser>>): Promise<Response | null> {
  const p = url.pathname;

  if (p === "/api/billing/zarinpal/create" && req.method === "POST") {
    return (async () => {
      const me = session ?? await getSessionUser(req, env);
      if (!me) return json({ ok: false, error: "unauthorized" }, 401);
      if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);

      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400);
      }
      const planTier = String(body?.planTier || "");
      const plan = getPlanDefinition(planTier);
      if (!plan) return json({ ok: false, error: "invalid_plan" }, 400);

      const callbackUrl = new URL("/billing/zarinpal/callback", url);
      const amountRials = plan.priceTomans * 10;
      const payload = paymentRequestBody(plan.tier, amountRials, callbackUrl.toString(), me.email);

      let zrRes: Response;
      try {
        zrRes = await fetch("https://api.zarinpal.com/pg/v4/payment/request.json", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err: any) {
        return json({ ok: false, error: "fetch_failed", details: String(err?.message || err) }, 502);
      }

      let zrBody: any = null;
      try {
        zrBody = await zrRes.json();
      } catch {
        return json({ ok: false, error: "bad_gateway" }, 502);
      }

      const code = zrBody?.data?.code;
      const authority = zrBody?.data?.authority;
      if (!zrRes.ok || !authority || (code !== 100 && code !== 101)) {
        const errMsg = zrBody?.errors?.[0]?.message || zrBody?.errors?.message || "payment_request_failed";
        return json({ ok: false, error: errMsg, code }, 502);
      }

      const record = {
        authority,
        email: me.email,
        planTier: plan.tier,
        months: plan.months,
        amountTomans: plan.priceTomans,
        amountRials,
        status: "pending" as const,
        createdAt: Date.now(),
        callbackUrl: callbackUrl.toString(),
      };
      await saveBillingRequest(env, record);

      return json({ ok: true, authority, payUrl: buildPaymentUrl(authority) });
    })();
  }

  if (p === "/billing/zarinpal/callback" && req.method === "GET") {
    return (async () => {
      if (!env?.DATA) return html(page("تأیید پرداخت", `<div class="card">Binding DATA تعریف نشده است.</div>`), 500);
      const me = await getSessionUser(req, env);
      if (!me) {
        return html(page("تأیید پرداخت", `<div class="card">برای مشاهده نتیجه پرداخت ابتدا وارد حساب خود شوید.</div>`), 401);
      }

      const authority = url.searchParams.get("Authority") || url.searchParams.get("authority") || "";
      const status = (url.searchParams.get("Status") || url.searchParams.get("status") || "").toUpperCase();
      if (!authority) {
        return html(page("تأیید پرداخت", `<div class="card">شناسه تراکنش (Authority) یافت نشد.</div>`), 400);
      }

      const record = await getBillingRequest(env, authority);
      if (!record || record.email.toLowerCase() !== me.email.toLowerCase()) {
        return html(page("تأیید پرداخت", `<div class="card">تراکنش معتبر برای این حساب پیدا نشد.</div>`), 403);
      }

      if (record.status === "verified") {
        const expires = formatDateFa(me.planExpiresAt ?? record.verifiedAt ?? null);
        const message = `<div class="card"><h2>پرداخت قبلاً تأیید شده است</h2><p>پلن شما فعال است.${expires ? ` انقضا: ${expires}` : ""}</p><p><a href="/student">بازگشت به صفحه دانشجو</a></p></div>`;
        return html(page("تأیید پرداخت", message));
      }

      if (status !== "OK") {
        await updateBillingRequest(env, authority, { status: "failed", statusMessage: `callback:${status}` });
        const msg = `<div class="card"><h2>پرداخت لغو شد</h2><p>وضعیت بازگشتی زرین‌پال: ${status || "نامشخص"}. اگر مبلغی کسر شده است با پشتیبانی تماس بگیرید.</p><p><a href="/student">بازگشت</a></p></div>`;
        return html(page("پرداخت ناموفق", msg));
      }

      let verifyRes: Response;
      try {
        verifyRes = await fetch("https://api.zarinpal.com/pg/v4/payment/verify.json", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            merchant_id: MERCHANT_ID,
            amount: record.amountRials,
            authority,
          }),
        });
      } catch (err: any) {
        await updateBillingRequest(env, authority, { status: "failed", statusMessage: `verify_fetch:${String(err?.message || err)}` });
        return html(page("خطا در تأیید", `<div class="card">ارتباط با زرین‌پال برقرار نشد. لطفاً دوباره تلاش کنید.</div>`), 502);
      }

      let verifyBody: any = null;
      try {
        verifyBody = await verifyRes.json();
      } catch {
        await updateBillingRequest(env, authority, { status: "failed", statusMessage: "verify_parse" });
        return html(page("خطا در تأیید", `<div class="card">پاسخ نامعتبر از زرین‌پال دریافت شد.</div>`), 502);
      }

      const verifyCode = verifyBody?.data?.code;
      if (verifyCode !== 100 && verifyCode !== 101) {
        const errMsg = verifyBody?.errors?.[0]?.message || verifyBody?.errors?.message || "verification_failed";
        await updateBillingRequest(env, authority, { status: "failed", statusMessage: `verify:${verifyCode}` });
        const body = `<div class="card"><h2>تأیید پرداخت ناموفق بود</h2><p>${errMsg}</p><p>اگر مبلغی کسر شده است با پشتیبانی تماس بگیرید.</p><p><a href="/student">بازگشت</a></p></div>`;
        return html(page("تأیید ناموفق", body), 502);
      }

      const refId = verifyBody?.data?.ref_id || verifyBody?.data?.refId || "";
      const verifiedAt = Date.now();
      await updateBillingRequest(env, authority, { status: "verified", refId, verifiedAt, statusMessage: `verify:${verifyCode}` });

      const plan = getPlanDefinition(record.planTier);
      if (!plan) {
        const body = `<div class="card">پلن مربوط به این تراکنش دیگر در دسترس نیست. با پشتیبانی تماس بگیرید.</div>`;
        return html(page("خطا", body), 500);
      }

      const now = Date.now();
      const base = me.planExpiresAt && me.planExpiresAt > now ? me.planExpiresAt : now;
      const expiresAt = base + monthsToMs(plan.months);

      await upsertUser(env, { email: me.email, planTier: plan.tier, planExpiresAt: expiresAt });
      const updatedUser = await getUserByEmail(env, me.email);
      const token = await signJWT({
        email: updatedUser?.email || me.email,
        name: updatedUser?.name || me.name || "",
        picture: updatedUser?.picture || me.picture || "",
        role: updatedUser?.role || me.role,
        planTier: updatedUser?.planTier || plan.tier,
        planExpiresAt: updatedUser?.planExpiresAt ?? expiresAt,
      }, env.JWT_SECRET, 60 * 60 * 24 * 30);

      const successBody = `<div class="card">
        <h2>پرداخت موفق بود</h2>
        <p>پلن ${plan.title} برای شما فعال شد.</p>
        <p>تاریخ انقضا: ${formatDateFa(expiresAt)}</p>
        ${refId ? `<p>شناسه پیگیری زرین‌پال: <code>${refId}</code></p>` : ""}
        <p><a href="/student">بازگشت به صفحه دانشجو</a></p>
      </div>`;

      return html(page("پرداخت موفق", successBody), 200, {
        "Set-Cookie": `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`,
      });
    })();
  }

  return null;
}
