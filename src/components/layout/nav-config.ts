import { LayoutDashboard, Users, UserCircle, CalendarRange, ClipboardList, FileText, CreditCard, CheckSquare, Dumbbell, Settings, CalendarClock, Home, Receipt, FolderOpen, Mail, type LucideIcon, Bell, ShieldCheck, Sparkles, Shield, CalendarDays, BarChart3, Upload } from "lucide-react";
import type { NamespaceKey } from "@/lib/i18n/translator";

export type NavKey = "admin" | "coach" | "parent";

/**
 * `labelKey` is the i18n key under "nav." (rendered via t(`nav.${labelKey}`));
 * `label` is the English fallback kept for non-localised consumers.
 */
export type NavItem = { label: string; labelKey: NamespaceKey<"nav">; href: string; icon: LucideIcon };

/** Admin nav entries that only show when the club enabled the feature. */
export const ASSISTANT_HREF = "/admin/assistant";

export const NAV: Record<NavKey, NavItem[]> = {
  admin: [
    { label: "Dashboard", labelKey: "dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
    { label: "Notifications", labelKey: "notifications", href: "/admin/notifications", icon: Bell },
    { label: "Documents", labelKey: "documents", href: "/admin/documents", icon: FolderOpen },
    { label: "Consents", labelKey: "consents", href: "/admin/consents", icon: ShieldCheck },
    { label: "Families", labelKey: "families", href: "/admin/families", icon: Users },
    { label: "Athletes", labelKey: "athletes", href: "/admin/athletes", icon: UserCircle },
    { label: "Programs", labelKey: "programs", href: "/admin/programs", icon: CalendarRange },
    { label: "Registrations", labelKey: "registrations", href: "/admin/registrations", icon: ClipboardList },
    { label: "Teams", labelKey: "teams", href: "/admin/teams", icon: Shield },
    { label: "Schedule", labelKey: "schedule", href: "/admin/schedule", icon: CalendarDays },
    { label: "Invoices", labelKey: "invoices", href: "/admin/invoices", icon: FileText },
    { label: "Payments", labelKey: "payments", href: "/admin/payments", icon: CreditCard },
    { label: "Attendance", labelKey: "attendance", href: "/admin/attendance", icon: CheckSquare },
    { label: "Bookings", labelKey: "bookings", href: "/admin/bookings", icon: Dumbbell },
    { label: "Services", labelKey: "services", href: "/admin/services", icon: Dumbbell },
    { label: "Invitations", labelKey: "invitations", href: "/admin/invitations", icon: Mail },
    { label: "Import", labelKey: "import", href: "/admin/import", icon: Upload },
    { label: "Reports", labelKey: "reports", href: "/admin/reports", icon: BarChart3 },
    { label: "Assistant", labelKey: "assistant", href: "/admin/assistant", icon: Sparkles },
    { label: "Settings", labelKey: "settings", href: "/admin/settings", icon: Settings },
  ],
  coach: [
    { label: "Schedule", labelKey: "schedule", href: "/coach/schedule", icon: CalendarClock },
    { label: "My team", labelKey: "myTeam", href: "/coach/team", icon: Shield },
    { label: "Attendance", labelKey: "attendance", href: "/coach/attendance", icon: CheckSquare },
    { label: "Availability", labelKey: "availability", href: "/coach/availability", icon: CalendarClock },
  ],
  parent: [
    { label: "Home", labelKey: "home", href: "/parent/home", icon: Home },
    { label: "Children", labelKey: "children", href: "/parent/children", icon: UserCircle },
    { label: "Schedule", labelKey: "schedule", href: "/parent/schedule", icon: CalendarDays },
    { label: "Invoices", labelKey: "invoices", href: "/parent/invoices", icon: Receipt },
    { label: "Bookings", labelKey: "bookings", href: "/parent/bookings", icon: Dumbbell },
    { label: "Attendance", labelKey: "attendance", href: "/parent/attendance", icon: CheckSquare },
    { label: "Notifications", labelKey: "notifications", href: "/parent/notifications", icon: Bell },
    { label: "Account", labelKey: "account", href: "/parent/account", icon: Settings },
    { label: "Documents", labelKey: "documents", href: "/parent/documents", icon: FolderOpen },
  ],
};
