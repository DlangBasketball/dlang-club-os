"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, ShoppingCart, Tag, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, Input, Label, Select, Textarea, FieldHint } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { placeOrder, quoteCart, type CartQuote } from "@/lib/actions/shop";
import {
  addToCart, cartStorageKey, cartTotals, fulfillmentOptions, parseCart, removeLine, setQuantity,
  type CartLine, type CatalogVariant,
} from "@/lib/shop/cart";
import type { ShopProduct } from "@/lib/shop/data";

type Buyer = { name: string; email: string; phone: string };

function readCart(key: string): CartLine[] {
  try {
    return parseCart(window.localStorage.getItem(key));
  } catch {
    return [];
  }
}
function writeCart(key: string, cart: CartLine[]) {
  try {
    if (cart.length) window.localStorage.setItem(key, JSON.stringify(cart));
    else window.localStorage.removeItem(key);
  } catch {
    /* private mode / storage full: the cart lives in memory */
  }
}

/**
 * Club shop: product grid, cart (kept in this browser per club), checkout
 * as a signed-in member or as a guest (name + email, no account needed).
 * Prices shown here are a preview; the order is priced by the database.
 */
export function Storefront({ orgId, products, catalog, currency, venues, member }: {
  orgId: string; products: ShopProduct[]; catalog: CatalogVariant[]; currency: string;
  venues: { id: string; name: string; address: string | null }[];
  member: { name: string; email: string } | null;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const key = cartStorageKey(orgId);
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [picked, setPicked] = React.useState<Record<string, string>>({});
  const [category, setCategory] = React.useState("");
  const [fulfillment, setFulfillment] = React.useState<"pickup" | "shipping">("pickup");
  const [venueId, setVenueId] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [promo, setPromo] = React.useState("");
  const [quote, setQuote] = React.useState<CartQuote | null>(null);
  const [buyer, setBuyer] = React.useState<Buyer>({ name: member?.name ?? "", email: member?.email ?? "", phone: "" });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => { setCart(readCart(key)); setLoaded(true); }, [key]);
  React.useEffect(() => { if (loaded) writeCart(key, cart); }, [cart, key, loaded]);

  const stockOf = React.useCallback((id: string) => catalog.find((c) => c.variantId === id)?.stock ?? 0, [catalog]);
  const options = fulfillmentOptions(cart, catalog);
  React.useEffect(() => {
    if (fulfillment === "pickup" && !options.pickup && options.shipping) setFulfillment("shipping");
    if (fulfillment === "shipping" && !options.shipping && options.pickup) setFulfillment("pickup");
    if (options.venueIds.length === 1) setVenueId(options.venueIds[0]);
  }, [options.pickup, options.shipping, options.venueIds, fulfillment]);
  const totals = cartTotals(cart, catalog, currency, fulfillment);
  React.useEffect(() => setQuote(null), [cart, fulfillment]);

  const categories = Array.from(new Set(products.map((p) => p.category).filter((c): c is string => !!c))).sort();
  const shown = category ? products.filter((p) => p.category === category) : products;

  function add(p: ShopProduct) {
    const vid = picked[p.id] ?? p.variants.find((v) => v.stock > 0)?.id;
    if (!vid) return;
    setCart((c) => addToCart(c, vid, 1, stockOf(vid)));
  }

  async function applyPromo() {
    setErr(null);
    const q = await quoteCart({ items: cart, fulfillment, promoCode: promo });
    if (!q.ok) return setErr(q.error ?? t("shop.errors.generic"));
    setQuote(q);
  }

  async function checkout(e: React.FormEvent) {
    e.preventDefault();
    if (!cart.length || totals.problems.length) return;
    setBusy(true); setErr(null);
    const res = await placeOrder({
      items: cart, buyer, fulfillment, pickupVenueId: fulfillment === "pickup" ? venueId || null : null,
      shippingAddress: fulfillment === "shipping" ? address : "", promoCode: promo, notes,
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setCart([]);
    writeCart(key, []);
    const d = res.data!;
    if (d.member) router.push(d.invoiceId ? `/parent/invoices/${d.invoiceId}` : "/shop/orders");
    else if (d.token) router.push(`/shop/order/${d.token}`);
  }

  const total = quote?.ok ? quote.total : totals.total;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-labelledby="shop-products" className="space-y-4">
        <h2 id="shop-products" className="sr-only">{t("shop.products")}</h2>
        {categories.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("shop.categories")}>
            <Button size="sm" variant={category === "" ? "primary" : "secondary"} onClick={() => setCategory("")}>{t("shop.allCategories")}</Button>
            {categories.map((c) => <Button key={c} size="sm" variant={category === c ? "primary" : "secondary"} onClick={() => setCategory(c)}>{c}</Button>)}
          </div>
        )}
        {shown.length === 0 ? <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-text-muted">{t("shop.empty")}</p> : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((p) => {
              const vid = picked[p.id] ?? p.variants.find((v) => v.stock > 0)?.id ?? p.variants[0]?.id;
              const v = p.variants.find((x) => x.id === vid);
              const soldOut = !v || v.stock <= 0;
              return (
                <li key={p.id}>
                  <Card className="flex h-full flex-col overflow-hidden">
                    <div className="aspect-square bg-surface-elevated">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.images[0] && <img src={p.images[0].url} alt={p.name} className="h-full w-full object-cover" loading="lazy" />}
                    </div>
                    <CardBody className="flex flex-1 flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                        {p.visibility === "members" && <Badge tone="accent">{t("shop.membersOnly")}</Badge>}
                      </div>
                      {p.description && <p className="line-clamp-3 text-sm text-text-muted">{p.description}</p>}
                      <p className="font-medium">{f.money(v?.price ?? p.price, p.currency)}</p>
                      {p.variants.length > 1 && (
                        <Select aria-label={t("shop.variant")} value={vid} onChange={(e) => setPicked((s) => ({ ...s, [p.id]: e.target.value }))}>
                          {p.variants.map((x) => (
                            <option key={x.id} value={x.id} disabled={x.stock <= 0}>
                              {(x.label ?? x.sku ?? p.name) + (x.stock <= 0 ? ` — ${t("shop.soldOut")}` : "")}
                            </option>
                          ))}
                        </Select>
                      )}
                      <div className="mt-auto pt-2">
                        <Button size="sm" className="w-full" disabled={soldOut} onClick={() => add(p)}>
                          <ShoppingCart className="h-4 w-4" aria-hidden /> {soldOut ? t("shop.soldOut") : t("shop.addToCart")}
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <aside aria-labelledby="shop-cart" className="lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardBody className="space-y-4">
            <h2 id="shop-cart" className="flex items-center gap-2 font-display text-lg font-semibold">
              <ShoppingCart className="h-5 w-5 text-brand-primary" aria-hidden /> {t("shop.cart.title")}
              {totals.itemCount > 0 && <Badge>{totals.itemCount}</Badge>}
            </h2>
            {cart.length === 0 ? <p className="text-sm text-text-muted">{t("shop.cart.empty")}</p> : (
              <form onSubmit={checkout} className="space-y-4">
                <ul className="space-y-2">
                  {totals.lines.map((l) => (
                    <li key={l.variantId} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{l.item?.name ?? t("shop.cart.unavailable")}</span>
                        {l.item?.label && <span className="block text-xs text-text-muted">{l.item.label}</span>}
                        {!l.available && <span className="block text-xs text-danger">{t("shop.cart.notEnoughStock")}</span>}
                      </span>
                      <button type="button" aria-label={t("shop.cart.decrease")} className="rounded border border-border p-1"
                        onClick={() => setCart((c) => setQuantity(c, l.variantId, l.quantity - 1, stockOf(l.variantId)))}><Minus className="h-3 w-3" aria-hidden /></button>
                      <span className="w-6 text-center tabular-nums" aria-label={t("shop.cart.quantity")}>{l.quantity}</span>
                      <button type="button" aria-label={t("shop.cart.increase")} className="rounded border border-border p-1"
                        onClick={() => setCart((c) => setQuantity(c, l.variantId, l.quantity + 1, stockOf(l.variantId)))}><Plus className="h-3 w-3" aria-hidden /></button>
                      <span className="w-20 text-right tabular-nums">{f.money(l.lineTotal, currency)}</span>
                      <button type="button" aria-label={t("shop.cart.remove")} onClick={() => setCart((c) => removeLine(c, l.variantId))}>
                        <Trash2 className="h-4 w-4 text-danger" aria-hidden /></button>
                    </li>
                  ))}
                </ul>

                <fieldset className="space-y-2">
                  <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("shop.checkout.fulfillment")}</legend>
                  {options.pickup && (
                    <label className="flex items-center gap-2 text-sm"><input type="radio" name="ful" checked={fulfillment === "pickup"} onChange={() => setFulfillment("pickup")} className="accent-[var(--red-primary)]" /> {t("shop.checkout.pickup")}</label>
                  )}
                  {options.shipping && (
                    <label className="flex items-center gap-2 text-sm"><input type="radio" name="ful" checked={fulfillment === "shipping"} onChange={() => setFulfillment("shipping")} className="accent-[var(--red-primary)]" /> {t("shop.checkout.shipping")}</label>
                  )}
                  {!options.pickup && !options.shipping && <p className="text-xs text-danger">{t("shop.errors.fulfillmentNotAvailable")}</p>}
                  {fulfillment === "pickup" && options.venueIds.length === 0 && venues.length > 0 && (
                    <Select aria-label={t("shop.checkout.pickupVenue")} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                      <option value="">{t("shop.checkout.pickupAnywhere")}</option>
                      {venues.map((v) => <option key={v.id} value={v.id}>{v.name}{v.address ? ` — ${v.address}` : ""}</option>)}
                    </Select>
                  )}
                  {fulfillment === "pickup" && options.venueIds.length === 1 && (
                    <p className="text-xs text-text-muted">{t("shop.checkout.pickupAt", { venue: venues.find((v) => v.id === options.venueIds[0])?.name ?? "" })}</p>
                  )}
                  {fulfillment === "shipping" && (
                    <div><Label htmlFor="sh-addr">{t("shop.checkout.address")}</Label>
                      <Textarea id="sh-addr" rows={3} value={address} maxLength={500} required onChange={(e) => setAddress(e.target.value)} /></div>
                  )}
                </fieldset>

                <div className="space-y-1">
                  <Label htmlFor="sh-promo">{t("shop.checkout.promo")}</Label>
                  <div className="flex gap-2">
                    <Input id="sh-promo" value={promo} maxLength={40} onChange={(e) => { setPromo(e.target.value.toUpperCase()); setQuote(null); }} className="font-mono" />
                    <Button type="button" size="sm" variant="secondary" disabled={!promo.trim()} onClick={applyPromo}><Tag className="h-4 w-4" aria-hidden /> {t("shop.checkout.apply")}</Button>
                  </div>
                  {quote?.promo === "applied" && <FieldHint>{t("shop.checkout.promoApplied")}</FieldHint>}
                  {quote?.promo === "rejected" && <FieldHint error>{quote.promoMessage}</FieldHint>}
                </div>

                <div className="space-y-1 border-t border-border pt-3 text-sm">
                  <div className="flex justify-between"><span className="text-text-muted">{t("shop.cart.subtotal")}</span><span className="tabular-nums">{f.money(totals.subtotal, currency)}</span></div>
                  {quote?.ok && quote.discounts.map((d) => (
                    <div key={d.name} className="flex justify-between text-success"><span>{d.name}</span><span className="tabular-nums">−{f.money(d.amount, currency)}</span></div>
                  ))}
                  {totals.shipping > 0 && <div className="flex justify-between"><span className="text-text-muted">{t("shop.cart.shipping")}</span><span className="tabular-nums">{f.money(totals.shipping, currency)}</span></div>}
                  <div className="flex justify-between font-semibold"><span>{t("shop.cart.total")}</span><span className="tabular-nums">{f.money(total, currency)}</span></div>
                  {!quote && <p className="text-xs text-text-muted">{t("shop.cart.discountsAtCheckout")}</p>}
                </div>

                <fieldset className="space-y-2">
                  <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{member ? t("shop.checkout.asMember") : t("shop.checkout.asGuest")}</legend>
                  <div><Label htmlFor="sh-name">{t("shop.checkout.name")}</Label>
                    <Input id="sh-name" value={buyer.name} maxLength={120} required autoComplete="name" onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))} /></div>
                  <div><Label htmlFor="sh-email">{t("shop.checkout.email")}</Label>
                    <Input id="sh-email" type="email" value={buyer.email} maxLength={254} required autoComplete="email" onChange={(e) => setBuyer((b) => ({ ...b, email: e.target.value }))} /></div>
                  <div><Label htmlFor="sh-phone">{t("shop.checkout.phone")}</Label>
                    <Input id="sh-phone" type="tel" value={buyer.phone} maxLength={40} autoComplete="tel" onChange={(e) => setBuyer((b) => ({ ...b, phone: e.target.value }))} /></div>
                  <div><Label htmlFor="sh-notes">{t("shop.checkout.notes")}</Label>
                    <Input id="sh-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></div>
                  {!member && <p className="text-xs text-text-muted">{t("shop.checkout.guestHint")}</p>}
                </fieldset>

                {err && <p role="alert" className="text-sm text-danger">{err}</p>}
                <Button type="submit" className="w-full" loading={busy} disabled={totals.problems.length > 0 || (!options.pickup && !options.shipping)}>
                  {t("shop.checkout.placeOrder")}
                </Button>
                <p className="text-xs text-text-muted">{t("shop.checkout.paymentHint")}</p>
              </form>
            )}
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}
