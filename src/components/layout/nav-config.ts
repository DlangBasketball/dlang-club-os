import { Globe, CalendarCheck, ClipboardCheck, NotebookPen, Timer, LayoutDashboard, Users, UserCircle, CalendarRange, ClipboardList, FileText, CreditCard, CheckSquare, Dumbbell, Settings, CalendarClock, Home, Receipt, FolderOpen, Mail, type LucideIcon, Bell, ShieldCheck, Sparkles, Shield, CalendarDays, BarChart3, Upload, UserCog, Percent, Tent, Coins, Wallet, TrendingUp, MessagesSquare, Megaphone, Inbox, ShoppingBag, Trophy, MapPin, ClipboardPen, FilePen, ListOrdered, Repeat, Images, Boxes, Landmark, Shirt, IdCard, Hourglass, Award, BadgeCheck, HeartPulse, HandHeart, Car, GraduationCap, Lock, Split, BookOpenCheck, Undo2, ArchiveRestore, Medal, School, MoreHorizontal } from "lucide-react";
import type { NamespaceKey } from "@/lib/i18n/translator";

export type NavKey = "admin" | "coach" | "parent";

/**
 * `labelKey` is the i18n key under "nav." (rendered via t(`nav.${labelKey}`));
 * `label` is the English fallback kept for non-localised consumers.
 */
export type NavItem = { label: string; labelKey: NamespaceKey<"nav">; href: string; icon: LucideIcon };

/** Admin nav entries that only show when the club enabled the feature. */
export const ASSISTANT_HREF = "/admin/assistant";
/** Communication entries only admins use (finance shares the admin app). */
/** Also: club-admin pages with minors' or staff data that finance must not open. */
export const ADMIN_ONLY_COMMS = ["/admin/alerts", "/admin/leads", "/admin/media", "/admin/site", "/admin/waitlists", "/admin/js", "/admin/staff-compliance", "/admin/incidents", "/admin/deleted", "/admin/alumni"];

/** Staff roles that use the admin app. */
export type AdminNavRole = "admin" | "finance";
const ADMIN: readonly AdminNavRole[] = ["admin"];
const STAFF: readonly AdminNavRole[] = ["admin", "finance"];

/**
 * One admin destination. `key` is stable (icons, tests); `roles` = who sees
 * it in the menu (pages keep their own server-side checks). The href of the
 * selection entries is a fallback: buildAdminNav() points them at the
 * club's own programme.
 */
export type AdminNavDef = NavItem & { key: string; roles: readonly AdminNavRole[] };
export type AdminNavGroupDef = { key: string; labelKey: NamespaceKey<"nav">; icon: LucideIcon; items: AdminNavDef[] };

/** Always on top, outside the groups. */
export const ADMIN_NAV_PINNED: AdminNavDef[] = [
  { key: "dashboard", label: "Dashboard", labelKey: "dashboard", href: "/admin/dashboard", icon: LayoutDashboard, roles: STAFF },
];

/** Entries whose target or label depends on the club's selection programmes. */
export const SELECTION_TOURNAMENTS_KEY = "selectionTournaments";
export const SELECTION_ROSTERS_KEY = "selectionRosters";
export const SELECTION_PAYMENTS_KEY = "selectionPayments";
export const SELECTION_GROUP_KEY = "selection";
export const SELECTION_HREF = "/admin/selection";

/**
 * Sidebar groups (collapsible). Every page the former flat menu listed is
 * here, under its closest group or "More".
 */
export const ADMIN_NAV_GROUPS: AdminNavGroupDef[] = [
  {
    key: "players", labelKey: "groups.players", icon: Users, items: [
      { key: "athletes", label: "Athletes", labelKey: "athletes", href: "/admin/athletes", icon: UserCircle, roles: STAFF },
      { key: "families", label: "Parents & payers", labelKey: "parentsPayers", href: "/admin/families", icon: Users, roles: STAFF },
      { key: "registrations", label: "Registrations", labelKey: "registrations", href: "/admin/registrations", icon: ClipboardList, roles: STAFF },
      { key: "waitlists", label: "Waiting lists", labelKey: "waitlists", href: "/admin/waitlists", icon: Hourglass, roles: ADMIN },
      { key: "development", label: "Development", labelKey: "development", href: "/admin/development", icon: TrendingUp, roles: ADMIN },
      { key: "journey", label: "Player journey", labelKey: "journey", href: "/admin/journey", icon: GraduationCap, roles: ADMIN },
      { key: "alumni", label: "Alumni & placements", labelKey: "alumni", href: "/admin/alumni", icon: School, roles: ADMIN },
      { key: "carpool", label: "Carpooling", labelKey: "carpool", href: "/admin/carpool", icon: Car, roles: ADMIN },
    ],
  },
  {
    key: "operations", labelKey: "groups.operations", icon: Shield, items: [
      { key: "teams", label: "Teams & rosters", labelKey: "teamsRosters", href: "/admin/teams", icon: Shield, roles: ADMIN },
      { key: "memberships", label: "Club memberships", labelKey: "clubMemberships", href: "/admin/memberships", icon: IdCard, roles: STAFF },
      { key: "programs", label: "Programs", labelKey: "programs", href: "/admin/programs", icon: CalendarRange, roles: ADMIN },
      { key: "attendance", label: "Attendance", labelKey: "attendance", href: "/admin/attendance", icon: CheckSquare, roles: ADMIN },
      { key: "coaches", label: "Coaches", labelKey: "coaches", href: "/admin/coaches", icon: UserCog, roles: ADMIN },
      { key: "staffCompliance", label: "Staff compliance", labelKey: "staffCompliance", href: "/admin/staff-compliance", icon: BadgeCheck, roles: ADMIN },
      { key: "timesheets", label: "Timesheets", labelKey: "timesheets", href: "/admin/timesheets", icon: Timer, roles: ADMIN },
      { key: "lessonPlans", label: "Lesson plans", labelKey: "lessonPlans", href: "/admin/lesson-plans", icon: NotebookPen, roles: ADMIN },
      { key: "locations", label: "Locations", labelKey: "locations", href: "/admin/locations", icon: MapPin, roles: ADMIN },
      { key: "operationsHub", label: "Operations", labelKey: "operations", href: "/admin/operations", icon: Boxes, roles: ADMIN },
      { key: "incidents", label: "Incidents", labelKey: "incidents", href: "/admin/incidents", icon: HeartPulse, roles: ADMIN },
      { key: "js", label: "J+S", labelKey: "js", href: "/admin/js", icon: Award, roles: ADMIN },
      { key: "shop", label: "Shop", labelKey: "shop", href: "/admin/shop", icon: ShoppingBag, roles: ADMIN },
      { key: "sponsorships", label: "Sponsorships", labelKey: "sponsorships", href: "/admin/sponsorships", icon: HandHeart, roles: ADMIN },
      // Committee members (any staff role) see the board; operationsHiddenHrefs() hides it for the others.
      { key: "board", label: "Board", labelKey: "board", href: "/board", icon: Landmark, roles: STAFF },
    ],
  },
  {
    key: SELECTION_GROUP_KEY, labelKey: "groups.selection", icon: Medal, items: [
      // buildAdminNav() puts one entry per division of the active programmes first.
      { key: SELECTION_ROSTERS_KEY, label: "Selection rosters", labelKey: "selectionRosters", href: SELECTION_HREF, icon: Medal, roles: ADMIN },
      { key: SELECTION_TOURNAMENTS_KEY, label: "Tournaments", labelKey: "selectionTournaments", href: SELECTION_HREF, icon: Trophy, roles: ADMIN },
    ],
  },
  {
    key: "calendar", labelKey: "groups.calendar", icon: CalendarCheck, items: [
      { key: "calendar", label: "Calendar", labelKey: "calendar", href: "/admin/calendar", icon: CalendarCheck, roles: ADMIN },
      { key: "bookings", label: "Bookings", labelKey: "bookings", href: "/admin/bookings", icon: Dumbbell, roles: ADMIN },
      { key: "services", label: "Services", labelKey: "services", href: "/admin/services", icon: Dumbbell, roles: ADMIN },
      { key: "schedule", label: "Schedule", labelKey: "schedule", href: "/admin/schedule", icon: CalendarDays, roles: ADMIN },
      { key: "training", label: "Training", labelKey: "training", href: "/admin/training", icon: Coins, roles: ADMIN },
    ],
  },
  {
    key: "finance", labelKey: "groups.finance", icon: Wallet, items: [
      { key: "invoices", label: "Invoices", labelKey: "invoices", href: "/admin/invoices", icon: FileText, roles: STAFF },
      { key: "payments", label: "Payments & allocations", labelKey: "paymentsAllocations", href: "/admin/payments", icon: CreditCard, roles: STAFF },
      { key: "clubMembershipPayments", label: "Club membership payments", labelKey: "clubMembershipPayments", href: "/admin/finance/club-membership-payments", icon: IdCard, roles: STAFF },
      { key: SELECTION_PAYMENTS_KEY, label: "Selection payments", labelKey: "selectionPayments", href: "/admin/finance/selection-payments", icon: Medal, roles: STAFF },
      { key: "credits", label: "Credits & refunds", labelKey: "creditsRefunds", href: "/admin/credits", icon: Undo2, roles: STAFF },
      { key: "accountingExports", label: "Accounting & exports", labelKey: "accountingExports", href: "/admin/accounting/exports", icon: Upload, roles: STAFF },
      { key: "accounting", label: "Accounting", labelKey: "accounting", href: "/admin/accounting", icon: BookOpenCheck, roles: STAFF },
      { key: "financeOverview", label: "Finance overview", labelKey: "financeOverview", href: "/admin/finance", icon: Wallet, roles: STAFF },
      { key: "paymentPlans", label: "Payment plans", labelKey: "paymentPlans", href: "/admin/payment-plans", icon: ListOrdered, roles: STAFF },
      { key: "recurringFees", label: "Recurring fees", labelKey: "recurringFees", href: "/admin/recurring-fees", icon: Repeat, roles: STAFF },
      { key: "familyBilling", label: "Split billing", labelKey: "familyBilling", href: "/admin/family-billing", icon: Split, roles: STAFF },
      { key: "discounts", label: "Discounts", labelKey: "discounts", href: "/admin/discounts", icon: Percent, roles: STAFF },
      { key: "reports", label: "Reports", labelKey: "reports", href: "/admin/reports", icon: BarChart3, roles: STAFF },
    ],
  },
  {
    key: "settings", labelKey: "groups.settings", icon: Settings, items: [
      { key: "seasons", label: "Seasons", labelKey: "seasons", href: "/admin/settings/seasons", icon: CalendarRange, roles: ADMIN },
      { key: "feesPaymentPlans", label: "Fees & payment plans", labelKey: "feesPaymentPlans", href: "/admin/payment-plans/settings", icon: ListOrdered, roles: STAFF },
      { key: "billingEntities", label: "Billing entities", labelKey: "billingEntities", href: "/admin/settings/billing-entities", icon: Landmark, roles: STAFF },
      { key: "staffPermissions", label: "Staff & permissions", labelKey: "staffPermissions", href: "/admin/settings/staff", icon: UserCog, roles: ADMIN },
      { key: "invitations", label: "Invitations", labelKey: "invitations", href: "/admin/invitations", icon: Mail, roles: ADMIN },
      { key: "clubSettings", label: "Club settings", labelKey: "clubSettings", href: "/admin/settings", icon: Settings, roles: ADMIN },
      { key: "sports", label: "Sports", labelKey: "sports", href: "/admin/sports", icon: Trophy, roles: ADMIN },
      { key: "import", label: "Import", labelKey: "import", href: "/admin/import", icon: Upload, roles: ADMIN },
      { key: "recentlyDeleted", label: "Recently deleted", labelKey: "recentlyDeleted", href: "/admin/deleted", icon: ArchiveRestore, roles: ADMIN },
      { key: "upgrades", label: "Plan & upgrades", labelKey: "upgrades", href: "/admin/upgrades", icon: Award, roles: STAFF },
    ],
  },
  {
    key: "more", labelKey: "groups.more", icon: MoreHorizontal, items: [
      { key: "notifications", label: "Notifications", labelKey: "notifications", href: "/admin/notifications", icon: Bell, roles: STAFF },
      { key: "messages", label: "Messages", labelKey: "messages", href: "/admin/messages", icon: MessagesSquare, roles: STAFF },
      { key: "alerts", label: "Alerts", labelKey: "alerts", href: "/admin/alerts", icon: Megaphone, roles: ADMIN },
      { key: "leads", label: "New contacts", labelKey: "leads", href: "/admin/leads", icon: Inbox, roles: ADMIN },
      { key: "documents", label: "Documents", labelKey: "documents", href: "/admin/documents", icon: FolderOpen, roles: ADMIN },
      { key: "consents", label: "Consents", labelKey: "consents", href: "/admin/consents", icon: ShieldCheck, roles: ADMIN },
      { key: "forms", label: "Forms", labelKey: "forms", href: "/admin/forms", icon: ClipboardPen, roles: ADMIN },
      { key: "contracts", label: "Contracts", labelKey: "contracts", href: "/admin/contracts", icon: FilePen, roles: ADMIN },
      { key: "media", label: "Media", labelKey: "media", href: "/admin/media", icon: Images, roles: ADMIN },
      { key: "site", label: "Website", labelKey: "site", href: "/admin/site", icon: Globe, roles: ADMIN },
      { key: "assistant", label: "Assistant", labelKey: "assistant", href: ASSISTANT_HREF, icon: Sparkles, roles: STAFF },
    ],
  },
];

const ALL_ADMIN_DEFS: AdminNavDef[] = [...ADMIN_NAV_PINNED, ...ADMIN_NAV_GROUPS.flatMap((g) => g.items)];

/** Every static admin destination, pinned first, one entry per href (search, legacy consumers). */
export const ADMIN_NAV_FLAT: AdminNavDef[] = ALL_ADMIN_DEFS.filter((d, i) => ALL_ADMIN_DEFS.findIndex((x) => x.href === d.href) === i);

/** Icon of each admin entry by key (the server hands the client keys, not components). */
export const SELECTION_DIVISION_ICON = "selectionDivision";
export const ADMIN_NAV_ICONS: Record<string, LucideIcon> = {
  ...Object.fromEntries(ALL_ADMIN_DEFS.map((d) => [d.key, d.icon])),
  ...Object.fromEntries(ADMIN_NAV_GROUPS.map((g) => [`group:${g.key}`, g.icon])),
  [SELECTION_DIVISION_ICON]: Medal,
};

export const NAV: Record<NavKey, NavItem[]> = {
  /** Flat list of the admin destinations (search, legacy consumers); the sidebar uses ADMIN_NAV_GROUPS. */
  admin: ADMIN_NAV_FLAT,
  coach: [
    { label: "Home", labelKey: "home", href: "/coach", icon: Home },
    { label: "Today's trainings", labelKey: "todaysTrainings", href: "/coach/trainings", icon: ClipboardCheck },
    { label: "Messages", labelKey: "messages", href: "/coach/messages", icon: MessagesSquare },
    { label: "Time clock", labelKey: "clock", href: "/coach/clock", icon: Timer },
    { label: "Calendar", labelKey: "calendar", href: "/coach/calendar", icon: CalendarCheck },
    { label: "Schedule", labelKey: "schedule", href: "/coach/schedule", icon: CalendarClock },
    { label: "My team", labelKey: "myTeam", href: "/coach/team", icon: Shield },
    { label: "Applications", labelKey: "selectionReview", href: "/coach/selection", icon: Medal },
    { label: "Attendance", labelKey: "attendance", href: "/coach/attendance", icon: CheckSquare },
    { label: "Availability", labelKey: "availability", href: "/coach/availability", icon: CalendarClock },
    { label: "Athletes", labelKey: "trainingAthletes", href: "/coach/training", icon: Dumbbell },
    { label: "Development", labelKey: "development", href: "/coach/development", icon: TrendingUp },
    { label: "Player journey", labelKey: "journey", href: "/coach/journey", icon: GraduationCap },
    { label: "Alumni & placements", labelKey: "alumni", href: "/coach/alumni", icon: School },
    { label: "Carpooling", labelKey: "carpool", href: "/coach/carpool", icon: Car },
    { label: "Roll calls", labelKey: "rollCalls", href: "/coach/roll-calls", icon: ClipboardCheck },
    { label: "Equipment", labelKey: "equipment", href: "/coach/equipment", icon: Boxes },
    { label: "Board", labelKey: "board", href: "/board", icon: Landmark },
    { label: "Incidents", labelKey: "incidents", href: "/coach/incidents", icon: HeartPulse },
    { label: "My certificates", labelKey: "myCertificates", href: "/coach/compliance", icon: BadgeCheck },
    { label: "Alerts", labelKey: "alerts", href: "/coach/alerts", icon: Megaphone },
  ],
  parent: [
    { label: "Home", labelKey: "home", href: "/parent/home", icon: Home },
    { label: "Messages", labelKey: "messages", href: "/parent/messages", icon: MessagesSquare },
    { label: "Children", labelKey: "children", href: "/parent/children", icon: UserCircle },
    { label: "Family", labelKey: "family", href: "/parent/family", icon: Users },
    { label: "My training", labelKey: "myTraining", href: "/parent/development", icon: TrendingUp },
    { label: "Schedule", labelKey: "schedule", href: "/parent/schedule", icon: CalendarDays },
    { label: "Carpooling", labelKey: "carpool", href: "/parent/carpool", icon: Car },
    { label: "Calendar", labelKey: "calendar", href: "/parent/calendar", icon: CalendarCheck },
    { label: "Camps", labelKey: "camps", href: "/parent/camps", icon: Tent },
    { label: "Programs", labelKey: "programmes", href: "/parent/programmes", icon: Medal },
    { label: "Waiting lists", labelKey: "waitlists", href: "/parent/waitlist", icon: Hourglass },
    { label: "Membership", labelKey: "membership", href: "/parent/membership", icon: IdCard },
    { label: "Invoices", labelKey: "invoices", href: "/parent/invoices", icon: Receipt },
    { label: "Payment plans & autopay", labelKey: "paymentPlans", href: "/parent/payment-plans", icon: ListOrdered },
    { label: "Cancellations & refunds", labelKey: "refunds", href: "/parent/refunds", icon: Undo2 },
    { label: "Bookings", labelKey: "bookings", href: "/parent/bookings", icon: Dumbbell },
    { label: "Attendance", labelKey: "attendance", href: "/parent/attendance", icon: CheckSquare },
    { label: "Incidents", labelKey: "incidents", href: "/parent/incidents", icon: HeartPulse },
    { label: "Notifications", labelKey: "notifications", href: "/parent/notifications", icon: Bell },
    { label: "Account", labelKey: "account", href: "/parent/account", icon: Settings },
    { label: "Privacy & data", labelKey: "privacy", href: "/parent/privacy", icon: Lock },
    { label: "Player journey", labelKey: "journey", href: "/parent/journey", icon: GraduationCap },
    { label: "Documents", labelKey: "documents", href: "/parent/documents", icon: FolderOpen },
    { label: "Shop", labelKey: "shop", href: "/shop", icon: ShoppingBag },
    { label: "Forms", labelKey: "forms", href: "/parent/forms", icon: ClipboardPen },
    { label: "Kit", labelKey: "kit", href: "/parent/kit", icon: Shirt },
    { label: "Board", labelKey: "board", href: "/board", icon: Landmark },
    { label: "Contracts", labelKey: "contracts", href: "/parent/contracts", icon: FilePen },
  ],
};
