import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { CheckCircle2 } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, statusTone } from "@/components/ui";
import { PayGuestButton } from "@/components/shop/pay-guest-button";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { getOrderByToken } from "@/lib/shop/data";
import { getOrgPaymentProfile, methodsForInvoice } from "@/lib/payments/settings";
import { buildSpcPayload, formatQrReference, resolveQrBillAccount } from "@/lib/swiss-payments";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Guest order page (the link in the confirmation): status, lines, totals and
 * how to pay. The token is the only credential; it maps to one order of the
 * request host's club (hash lookup), never to anything else.
 */
export default async function GuestOrderPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string }> }) {
  const [{ token }, sp, tenant] = await Promise.all([params, searchParams, getTenant()]);
  if (!tenant.id) notFound();
  const found = await getOrderByToken(tenant.id, token);
  if (!found) notFound();
  const { order: o, items, invoiceNumber, reference, venueName } = found;
  const { t, f } = await getI18n(tenant.id);
  const money = (n: number) => f.money(n, o.currency);
  const payable = o.status === "pending_payment" && !!o.invoice_id;

  let online = "";
  let bank: { iban: string; reference: string | null; creditor: string; qr: string | null } | null = null;
  if (payable) {
    const profile = await getOrgPaymentProfile(tenant.id);
    const methods = methodsForInvoice(profile, o.currency);
    const stripe = methods.filter((m) => m.via === "stripe");
    if (stripe.length) {
      try { online = new Intl.ListFormat(f.locale, { type: "disjunction" }).format(stripe.map((m) => m.label)); } catch { online = stripe.map((m) => m.label).join(", "); }
    }
    if (methods.some((m) => m.key === "bank_transfer" || m.key === "qr_bill")) {
      const account = profile.region === "CH" ? resolveQrBillAccount(profile.swiss, reference) : null;
      const iban = account?.iban ?? (profile.swiss.iban || profile.settings.iban || "");
      let qr: string | null = null;
      if (account && (o.currency === "CHF" || o.currency === "EUR")) {
        try {
          qr = await QRCode.toDataURL(buildSpcPayload({
            settings: profile.swiss, amount: o.total, currency: o.currency as "CHF" | "EUR", reference: reference ?? "",
            debtorName: o.buyer_name, message: invoiceNumber,
          }), { errorCorrectionLevel: "M", margin: 1, width: 220 });
        } catch { qr = null; }
      }
      if (iban) {
        bank = {
          iban, creditor: profile.swiss.creditorName || profile.name, qr,
          reference: account?.reference ? (account.referenceType === "QRR" ? formatQrReference(account.reference) : account.reference) : invoiceNumber,
        };
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 animate-fade-up">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-success-soft text-success"><CheckCircle2 className="h-6 w-6" aria-hidden /></span>
        <div>
          <h1 className="font-display text-2xl font-semibold">{t("shop.order.title", { number: o.number })}</h1>
          <p className="text-sm text-text-muted">{t("shop.order.thanks", { email: o.buyer_email })}</p>
          <p className="mt-1 text-xs text-text-muted">{t("shop.order.keepLink")}</p>
        </div>
      </div>
      {sp.paid && o.status === "pending_payment" && <p role="status" className="rounded-md border border-border p-3 text-sm">{t("shop.order.paymentProcessing")}</p>}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2">{t("shop.orders.items")} <Badge tone={statusTone(o.status)}>{t.dynamic(`shop.status.${o.status}`, undefined, o.status)}</Badge></CardTitle></CardHeader>
        <CardBody className="space-y-1 text-sm">
          {items.map((it) => (
            <div key={it.id} className="flex justify-between gap-3"><span>{it.quantity} × {it.name}{it.variant_label ? ` (${it.variant_label})` : ""}</span><span className="tabular-nums">{money(it.line_total)}</span></div>
          ))}
          <div className="mt-2 space-y-1 border-t border-border pt-2">
            {o.discount_total > 0 && <div className="flex justify-between text-success"><span>{t("shop.cart.discount")}</span><span className="tabular-nums">−{money(o.discount_total)}</span></div>}
            {o.shipping_total > 0 && <div className="flex justify-between"><span>{t("shop.cart.shipping")}</span><span className="tabular-nums">{money(o.shipping_total)}</span></div>}
            <div className="flex justify-between font-semibold"><span>{t("shop.cart.total")}</span><span className="tabular-nums">{money(o.total)}</span></div>
          </div>
          <p className="pt-2 text-text-muted">
            {o.fulfillment === "pickup" ? t("shop.order.pickupNote", { venue: venueName ?? t("shop.checkout.pickupAnywhere") }) : t("shop.order.shippingNote")}
          </p>
        </CardBody>
      </Card>
      {payable && (
        <Card>
          <CardHeader><CardTitle>{t("shop.order.howToPay")}</CardTitle></CardHeader>
          <CardBody className="space-y-4 text-sm">
            {online && <PayGuestButton token={token} methods={online} />}
            {bank && (
              <div className="flex flex-col gap-4 sm:flex-row">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {bank.qr && <img src={bank.qr} alt={t("shop.order.qrAlt")} width={160} height={160} className="rounded bg-white p-1" />}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-text-muted">{t("shop.order.creditor")}</dt><dd>{bank.creditor}</dd>
                  <dt className="text-text-muted">{t("shop.order.iban")}</dt><dd className="font-mono">{bank.iban}</dd>
                  {bank.reference && <><dt className="text-text-muted">{t("shop.order.reference")}</dt><dd className="font-mono">{bank.reference}</dd></>}
                  <dt className="text-text-muted">{t("shop.cart.total")}</dt><dd>{money(o.total)}</dd>
                </dl>
              </div>
            )}
            {!online && !bank && <p className="text-text-muted">{t("shop.order.clubWillContact")}</p>}
          </CardBody>
        </Card>
      )}
      <Link href="/shop" className="text-sm text-brand-primary hover:underline">{t("shop.continueShopping")}</Link>
    </div>
  );
}
