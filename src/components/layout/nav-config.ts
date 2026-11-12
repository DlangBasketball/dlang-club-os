import { LayoutDashboard, Users, UserCircle, CalendarRange, ClipboardList, FileText, CreditCard, CheckSquare, Dumbbell, Settings, CalendarClock, Home, Receipt, FolderOpen, Mail, type LucideIcon, Bell, ShieldCheck, Sparkles, Upload } from "lucide-react";

export type NavKey = "admin" | "coach" | "parent";

export type NavItem = { label: string; href: string; icon: LucideIcon };

export const NAV: Record<NavKey, NavItem[]> = {
  admin: [
    { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
    { label: "Notifications", href: "/admin/notifications", icon: Bell },
    { label: "Documents", href: "/admin/documents", icon: FolderOpen },
    { label: "Consents", href: "/admin/consents", icon: ShieldCheck },
    { label: "Families", href: "/admin/families", icon: Users },
    { label: "Athletes", href: "/admin/athletes", icon: UserCircle },
    { label: "Programs", href: "/admin/programs", icon: CalendarRange },
    { label: "Registrations", href: "/admin/registrations", icon: ClipboardList },
    { label: "Invoices", href: "/admin/invoices", icon: FileText },
    { label: "Payments", href: "/admin/payments", icon: CreditCard },
    { label: "Attendance", href: "/admin/attendance", icon: CheckSquare },
    { label: "Bookings", href: "/admin/bookings", icon: Dumbbell },
    { label: "Services", href: "/admin/services", icon: Dumbbell },
    { label: "Invitations", href: "/admin/invitations", icon: Mail },
    { label: "Import", href: "/admin/import", icon: Upload },
    { label: "Assistant", href: "/admin/assistant", icon: Sparkles },
    { label: "Settings", href: "/admin/settings", icon: Settings },
  ],
  coach: [
    { label: "Schedule", href: "/coach/schedule", icon: CalendarClock },
    { label: "Attendance", href: "/coach/attendance", icon: CheckSquare },
    { label: "Availability", href: "/coach/availability", icon: CalendarClock },
    { label: "Assistant", href: "/coach/assistant", icon: Sparkles },
  ],
  parent: [
    { label: "Home", href: "/parent/home", icon: Home },
    { label: "Children", href: "/parent/children", icon: UserCircle },
    { label: "Invoices", href: "/parent/invoices", icon: Receipt },
    { label: "Bookings", href: "/parent/bookings", icon: Dumbbell },
    { label: "Attendance", href: "/parent/attendance", icon: CheckSquare },
    { label: "Notifications", href: "/parent/notifications", icon: Bell },
    { label: "Assistant", href: "/parent/assistant", icon: Sparkles },
    { label: "Account", href: "/parent/account", icon: Settings },
    { label: "Documents", href: "/parent/documents", icon: FolderOpen },
  ],
};
