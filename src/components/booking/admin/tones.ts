import type { BadgeProps } from "@/components/ui";
import type { BillingStatus, BookingNotificationStatus, BookingState } from "@/lib/booking/types";

/* Badge tones of the booking statuses (labels: bookingWorkflow.state / billingStatus / notificationStatus). */

export function stateTone(s: BookingState | string): BadgeProps["tone"] {
  return s === "confirmed" ? "success" : s === "completed" ? "info" : s === "no_show" ? "warning" : s === "cancelled" ? "danger"
    : s === "requested" ? "accent" : "neutral";
}

export function billingTone(s: BillingStatus | string): BadgeProps["tone"] {
  switch (s) {
    case "paid": return "success";
    case "to_invoice": case "invoice_draft": return "warning";
    case "invoiced": case "partially_paid": return "info";
    case "package": return "accent";
    case "credited": return "danger";
    default: return "neutral";
  }
}

export function deliveryTone(s: BookingNotificationStatus | string): BadgeProps["tone"] {
  return s === "sent" ? "success" : s === "failed" || s === "no_contact" ? "danger" : s === "pending" || s === "sending" ? "warning" : "neutral";
}
