import { formatCHF } from "@/lib/utils";

const BRAND = "#DA2627";
const BG = "#0A0A0A";

/** Issuing club (tenant). Optional so callers without an org still render. */
export type ClubBrand = { clubName?: string | null };
const clubOf = (d: ClubBrand) => d.clubName?.trim() || process.env.NEXT_PUBLIC_PLATFORM_NAME || "Club OS";

function shell(title: string, inner: string, club: string) {
  return `<!doctype html><html><body style="margin:0;background:${BG};font-family:Helvetica,Arial,sans-serif;color:#F1F1F1;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:${BRAND};font-weight:700;">${club}</div>
    <h1 style="font-size:24px;margin:12px 0 20px;color:#fff;">${title}</h1>
    ${inner}
    <hr style="border:none;border-top:1px solid #2A2A2A;margin:28px 0;" />
    <p style="font-size:12px;color:#8A8A8A;line-height:1.6;">${club} · This is an automated message. Reply to reach the club office.</p>
  </div></body></html>`;
}

export type ConfirmationData = {
  parentName: string;
  programName: string;
  children: string[];
  invoiceNumber: string;
  totalChf: number;
  dueDateLabel: string;
  manageUrl: string;
};

/** Sent to the parent after a successful registration. */
export function registrationConfirmation(d: ConfirmationData & ClubBrand): { subject: string; html: string } {
  const kids = d.children.map((c) => `<li style="margin:2px 0;">${c}</li>`).join("");
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">Hi ${d.parentName}, thanks for registering with ${clubOf(d)}. Here's a summary of your registration.</p>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:18px 20px;margin:18px 0;">
      <div style="font-size:12px;color:#8A8A8A;text-transform:uppercase;letter-spacing:.1em;">Program</div>
      <div style="font-size:17px;color:#fff;margin:2px 0 14px;">${d.programName}</div>
      <div style="font-size:12px;color:#8A8A8A;text-transform:uppercase;letter-spacing:.1em;">Participant${d.children.length > 1 ? "s" : ""}</div>
      <ul style="margin:6px 0 14px;padding-left:18px;color:#D8D8D8;font-size:15px;">${kids}</ul>
      <div style="display:flex;justify-content:space-between;border-top:1px solid #2A2A2A;padding-top:14px;">
        <span style="color:#8A8A8A;">Invoice ${d.invoiceNumber}</span>
        <span style="color:#fff;font-weight:700;">${formatCHF(d.totalChf)}</span>
      </div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:6px;">Payment due by ${d.dueDateLabel}</div>
    </div>
    <a href="${d.manageUrl}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Complete payment &amp; set up your account</a>
    <p style="font-size:13px;color:#8A8A8A;margin-top:18px;line-height:1.6;">A club admin will confirm your spot shortly. You'll receive a separate email to set up your parent account, where you can pay the invoice and manage your registration.</p>`;
  return {
    subject: `Registration received — ${d.programName} (${d.invoiceNumber})`,
    html: shell("Registration received", inner, clubOf(d)),
  };
}

/** Internal heads-up to the club inbox. */
export function adminRegistrationAlert(d: ({ programName: string; parentName: string; children: string[]; totalChf: number; invoiceNumber: string }) & ClubBrand): { subject: string; html: string } {
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">A new registration just came in.</p>
    <ul style="color:#D8D8D8;font-size:15px;line-height:1.9;">
      <li>Program: <strong style="color:#fff;">${d.programName}</strong></li>
      <li>Parent: <strong style="color:#fff;">${d.parentName}</strong></li>
      <li>Children: ${d.children.join(", ")}</li>
      <li>Invoice: ${d.invoiceNumber} — ${formatCHF(d.totalChf)}</li>
    </ul>`;
  return { subject: `New registration — ${d.programName}`, html: shell("New registration", inner, clubOf(d)) };
}

export type InvoiceEmailData = {
  parentName: string;
  invoiceNumber: string;
  description: string | null;
  totalChf: number;
  dueDateLabel: string;
  payUrl: string;
};

/** Sent when an invoice is issued to a parent. */
export function invoiceIssued(d: InvoiceEmailData & ClubBrand): { subject: string; html: string } {
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">Hi ${d.parentName}, a new invoice is ready for your account.</p>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:18px 20px;margin:18px 0;">
      <div style="display:flex;justify-content:space-between;"><span style="color:#8A8A8A;">Invoice ${d.invoiceNumber}</span><span style="color:#fff;font-weight:700;">${formatCHF(d.totalChf)}</span></div>
      ${d.description ? `<div style="font-size:13px;color:#B8B8B8;margin-top:8px;">${d.description}</div>` : ""}
      <div style="font-size:13px;color:#8A8A8A;margin-top:8px;">Due by ${d.dueDateLabel}</div>
    </div>
    <a href="${d.payUrl}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Pay now</a>
    <p style="font-size:13px;color:#8A8A8A;margin-top:18px;">You can pay by card, TWINT or bank transfer from your parent account.</p>`;
  return { subject: `Invoice ${d.invoiceNumber} — ${formatCHF(d.totalChf)}`, html: shell("New invoice", inner, clubOf(d)) };
}

/** Overdue reminder. */
export function overdueReminder(d: InvoiceEmailData & ClubBrand): { subject: string; html: string } {
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">Hi ${d.parentName}, our records show invoice <strong style="color:#fff;">${d.invoiceNumber}</strong> is past its due date.</p>
    <div style="background:#1A1A1A;border:1px solid ${BRAND};border-radius:12px;padding:18px 20px;margin:18px 0;">
      <div style="display:flex;justify-content:space-between;"><span style="color:#8A8A8A;">Amount due</span><span style="color:#fff;font-weight:700;">${formatCHF(d.totalChf)}</span></div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:8px;">Was due ${d.dueDateLabel}</div>
    </div>
    <a href="${d.payUrl}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Settle invoice</a>
    <p style="font-size:13px;color:#8A8A8A;margin-top:18px;">If you've already paid, please disregard this reminder.</p>`;
  return { subject: `Reminder: invoice ${d.invoiceNumber} is overdue`, html: shell("Payment reminder", inner, clubOf(d)) };
}

/** Receipt after a payment is recorded. */
export function paymentReceived(d: ({ parentName: string; invoiceNumber: string; amountChf: number; balanceChf: number }) & ClubBrand): { subject: string; html: string } {
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">Hi ${d.parentName}, we've received your payment — thank you.</p>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:18px 20px;margin:18px 0;">
      <div style="display:flex;justify-content:space-between;"><span style="color:#8A8A8A;">Invoice ${d.invoiceNumber}</span><span style="color:#2F9E55;font-weight:700;">+ ${formatCHF(d.amountChf)}</span></div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:8px;">Remaining balance: ${formatCHF(d.balanceChf)}</div>
    </div>`;
  return { subject: `Payment received — ${d.invoiceNumber}`, html: shell("Payment received", inner, clubOf(d)) };
}

export function bookingConfirmation(d: ({ parentName: string; athleteName: string; serviceName: string; coachName: string; when: string; payNote: string }) & ClubBrand): { subject: string; html: string } {
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">Hi ${d.parentName}, ${d.athleteName}'s session is confirmed.</p>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:18px 20px;margin:18px 0;">
      <div style="font-size:16px;color:#F1F1F1;font-weight:700;">${d.serviceName}</div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:6px;">${d.when}</div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:4px;">Coach: ${d.coachName}</div>
      <div style="font-size:13px;color:#D8D8D8;margin-top:10px;">${d.payNote}</div>
    </div>`;
  return { subject: `Booking confirmed — ${d.serviceName}`, html: shell("Booking confirmed", inner, clubOf(d)) };
}

export function coachBookingAlert(d: ({ coachName: string; athleteName: string; serviceName: string; when: string }) & ClubBrand): { subject: string; html: string } {
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">Hi ${d.coachName}, you have a new booking.</p>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:18px 20px;margin:18px 0;">
      <div style="font-size:16px;color:#F1F1F1;font-weight:700;">${d.serviceName}</div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:6px;">${d.when}</div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:4px;">Athlete: ${d.athleteName}</div>
    </div>`;
  return { subject: `New booking — ${d.athleteName}`, html: shell("New booking", inner, clubOf(d)) };
}
