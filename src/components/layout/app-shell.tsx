"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LogOut, MoreHorizontal } from "lucide-react";
import { NAV, type NavKey, type NavItem } from "./nav-config";
import { BrandMark } from "./brand-mark";
import type { SessionUser } from "@/lib/auth/get-user";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { NotificationBell } from "./notification-bell";
import type { NavNotification } from "@/lib/data/notifications";
import { useT } from "@/lib/i18n/client";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { RoleModeSwitcher } from "./role-mode-switcher";
import { CommandPalette } from "@/components/search/command-palette";
import { OrgSwitcher, type SwitcherOrg } from "@/components/family/org-switcher";
import { AdminSidebarNav, useNavLabel } from "./admin-sidebar-nav";
import type { AdminNavModel } from "./admin-nav";

type NotifProp = { data: { items: NavNotification[]; unread: number }; viewAllHref?: string } | undefined;

/** Max tabs shown in the mobile bottom bar before the rest move to "More". */
const MAX_TABS = 5;

/**
 * App layout shell (visuals follow the V1 prototype admin shell / mobile apps).
 *  - variant "sidebar" (admin/finance): sticky left rail on desktop, drawer on mobile.
 *  - variant "bottom"  (coach/parent): mobile-first with a bottom tab bar.
 */
export function AppShell({
  navKey,
  user,
  notifications,
  hiddenHrefs,
  lockedHrefs,
  profilePhotoUrl,
  orgs,
  adminNav,
  subHeader,
  children,
}: {
  navKey: NavKey;
  user: SessionUser;
  notifications?: NotifProp;
  /** Nav destinations to hide for this user/club (e.g. a feature the club has not enabled). */
  hiddenHrefs?: string[];
  /** Nav destinations outside the club's plan: shown with an "Upgrade" badge (admins / finance). */
  lockedHrefs?: string[];
  /** The person's clubs (one login, several clubs); a switcher shows when there are 2+. */
  orgs?: SwitcherOrg[];
  /**
   * Signed URL of the signed-in user's own profile photo (e.g. the coach's
   * photo in the coach app). undefined = no header avatar; null = initials.
   */
  profilePhotoUrl?: string | null;
  /** Grouped admin menu built on the server (admin app); without it the flat list renders. */
  adminNav?: AdminNavModel;
  /** Bar under the mobile header (parent app: the active-athlete switcher). */
  subHeader?: React.ReactNode;
  children: React.ReactNode;
}) {
  const variant = navKey === "admin" ? "sidebar" : "bottom";
  const t = useT();
  return (
    <>
      <a href="#main" className="skip-link">
        {t("shell.skipToContent")}
      </a>
      <HiddenNavContext.Provider value={hiddenHrefs ?? NO_HIDDEN}>
      <LockedNavContext.Provider value={lockedHrefs ?? NO_HIDDEN}>
      <OrgsContext.Provider value={orgs ?? NO_ORGS}>
      {variant === "sidebar" ? (
        <SidebarShell navKey={navKey} user={user} notifications={notifications} profilePhotoUrl={profilePhotoUrl} adminNav={adminNav}>
          {children}
        </SidebarShell>
      ) : (
        <BottomShell navKey={navKey} user={user} notifications={notifications} profilePhotoUrl={profilePhotoUrl} subHeader={subHeader}>
          {children}
        </BottomShell>
      )}
      </OrgsContext.Provider>
      </LockedNavContext.Provider>
      </HiddenNavContext.Provider>
    </>
  );
}

const NO_HIDDEN: string[] = [];
const NO_ORGS: SwitcherOrg[] = [];
const OrgsContext = React.createContext<SwitcherOrg[]>(NO_ORGS);

function ShellOrgSwitcher({ className }: { className?: string }) {
  const orgs = React.useContext(OrgsContext);
  return <OrgSwitcher orgs={orgs} className={className} />;
}
const HiddenNavContext = React.createContext<string[]>(NO_HIDDEN);
const LockedNavContext = React.createContext<string[]>(NO_HIDDEN);

/** NAV[navKey] minus the destinations hidden for this user/club. */
function useNavItems(navKey: NavKey): NavItem[] {
  const hidden = React.useContext(HiddenNavContext);
  return React.useMemo(() => NAV[navKey].filter((i) => !hidden.includes(i.href)), [navKey, hidden]);
}

function useIsActive() {
  const pathname = usePathname();
  return React.useCallback(
    (href: string, aliases?: string[]) =>
      [href, ...(aliases ?? [])].some((h) => pathname === h || pathname.startsWith(`${h}/`)),
    [pathname],
  );
}

/** Close an overlay on Escape. */
function useEscape(open: boolean, onClose: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

const iconBtn =
  "touch-target inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors duration-150 hover:border-brand-primary hover:text-brand-primary focus-visible:outline-none focus-visible:shadow-focus";

function NavLinks({
  navKey,
  onNavigate,
}: {
  navKey: NavKey;
  onNavigate?: () => void;
}) {
  const isActive = useIsActive();
  const navLabel = useNavLabel();
  const items = useNavItems(navKey);
  const locked = React.useContext(LockedNavContext);
  const t = useT();
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map(({ labelKey, href, icon: Icon, aliases }) => {
        const active = isActive(href, aliases);
        return (
          <li key={href}>
            <Link
              href={href as never}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "touch-target group relative flex items-center gap-[11px] rounded-md px-3.5 py-[9px] text-[13.5px] transition-colors duration-150",
                "focus-visible:outline-none focus-visible:shadow-focus",
                active
                  ? "bg-gradient-to-r from-brand-primary-soft to-transparent font-medium text-brand-primary rtl:bg-gradient-to-l"
                  : "text-text-secondary hover:bg-surface hover:text-text",
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-brand-primary shadow-glow"
                />
              )}
              <Icon
                aria-hidden
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  active ? "text-brand-primary" : "text-text-muted group-hover:text-brand-primary",
                )}
              />
              {navLabel(labelKey)}
              {locked.includes(href) && (
                <span className="ml-auto rounded-full border border-brand-accent/40 bg-brand-accent-soft px-1.5 py-px text-[10.5px] font-medium text-brand-accent">
                  {t("upgrades.badge")}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Grouped admin menu when the server built one, else the flat list. */
function SidebarLinks({
  navKey,
  adminNav,
  userId,
  onNavigate,
}: {
  navKey: NavKey;
  adminNav?: AdminNavModel;
  userId: string;
  onNavigate?: () => void;
}) {
  if (!adminNav) return <NavLinks navKey={navKey} onNavigate={onNavigate} />;
  return <AdminSidebarNav model={adminNav} userId={userId} onNavigate={onNavigate} />;
}

function SignOutButton({ className }: { className?: string }) {
  const t = useT();
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        aria-label={t("shell.signOut")}
        title={t("shell.signOut")}
        className={cn(
          "touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface hover:text-danger focus-visible:outline-none focus-visible:shadow-focus",
          className,
        )}
      >
        <LogOut className="h-4 w-4" aria-hidden />
      </button>
    </form>
  );
}

function UserMenu({ user, photoUrl }: { user: SessionUser; photoUrl?: string | null }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2.5 border-t border-border px-4 py-3.5">
      <Avatar name={user.fullName ?? user.email} src={photoUrl ?? null} tone="accent" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[12.5px] font-medium text-text">
          {user.fullName ?? t("shell.member")}
        </div>
        <div className="truncate text-[11px] text-text-muted">{user.email}</div>
      </div>
      <SignOutButton />
    </div>
  );
}

function SidebarShell({
  navKey,
  user,
  notifications,
  profilePhotoUrl,
  adminNav,
  children,
}: {
  navKey: NavKey;
  user: SessionUser;
  notifications?: NotifProp;
  profilePhotoUrl?: string | null;
  adminNav?: AdminNavModel;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const t = useT();
  const close = React.useCallback(() => setOpen(false), []);
  useEscape(open, close);

  return (
    <div className="grain min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-e border-border bg-bg-secondary lg:flex">
        <div className="border-b border-border px-5 pb-5 pt-[22px]">
          <BrandMark />
        </div>
        <nav aria-label={t("shell.mainNavigation")} className="flex-1 overflow-y-auto px-2 py-3">
          <SidebarLinks navKey={navKey} adminNav={adminNav} userId={user.id} />
        </nav>
        <UserMenu user={user} photoUrl={profilePhotoUrl} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t("shell.mainNavigation")}>
          <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm" onClick={close} />
          <aside className="absolute start-0 top-0 flex h-full w-[min(18rem,85vw)] animate-slide-in-left flex-col border-e border-border bg-bg-secondary shadow-lg rtl:animate-slide-in-right">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <BrandMark />
              <button onClick={close} aria-label={t("shell.closeMenu")} className={iconBtn} autoFocus>
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <nav aria-label={t("shell.mainNavigation")} className="flex-1 overflow-y-auto px-2 py-3">
              <SidebarLinks navKey={navKey} adminNav={adminNav} userId={user.id} onNavigate={close} />
            </nav>
            <UserMenu user={user} photoUrl={profilePhotoUrl} />
          </aside>
        </div>
      )}

      <div className="flex min-h-dvh min-w-0 flex-col">
        {/* Top bar (desktop + mobile) */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg-secondary/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-bg-secondary/75 sm:px-6 lg:h-[60px] lg:px-9">
          <button
            onClick={() => setOpen(true)}
            aria-label={t("shell.openMenu")}
            aria-expanded={open}
            className={cn(iconBtn, "lg:hidden")}
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <BrandMark compact className="lg:hidden" />
          <RoleModeSwitcher modes={user.modes} mode={user.mode} roles={user.allRoles} />
          <div className="flex-1" />
          <ShellOrgSwitcher />
          <CommandPalette />
          <LanguageSwitcher variant="compact" />
          {notifications && (
            <NotificationBell initial={notifications.data} viewAllHref={notifications.viewAllHref} />
          )}
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1340px] flex-1 px-4 pb-16 pt-6 focus:outline-none sm:px-6 lg:px-9 lg:pt-7">
          {children}
        </main>
      </div>
    </div>
  );
}

function BottomShell({
  navKey,
  user,
  notifications,
  profilePhotoUrl,
  subHeader,
  children,
}: {
  navKey: NavKey;
  user: SessionUser;
  notifications?: NotifProp;
  profilePhotoUrl?: string | null;
  subHeader?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  const isActive = useIsActive();
  const items = useNavItems(navKey);
  const overflow = items.length > MAX_TABS;
  const primary = overflow ? items.slice(0, MAX_TABS - 1) : items;
  const extra = overflow ? items.slice(MAX_TABS - 1) : [];
  const [moreOpen, setMoreOpen] = React.useState(false);
  const closeMore = React.useCallback(() => setMoreOpen(false), []);
  useEscape(moreOpen, closeMore);
  const extraActive = extra.some((i) => isActive(i.href, i.aliases));

  return (
    <div className="grain mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg-secondary/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-bg-secondary/75">
        <div className="flex shrink-0 items-center gap-2">
          <BrandMark compact />
          <RoleModeSwitcher modes={user.modes} mode={user.mode} roles={user.allRoles} />
        </div>
        <div className={cn("flex min-w-0 items-center", user.modes.length > 1 ? "gap-0.5 sm:gap-1.5" : "gap-1.5")}>
          <ShellOrgSwitcher className="max-sm:[&_svg]:hidden" />
          <CommandPalette />
          <LanguageSwitcher variant="compact" />
          {notifications && (
            <NotificationBell initial={notifications.data} viewAllHref={notifications.viewAllHref} />
          )}
          {profilePhotoUrl !== undefined && (
            <span className={user.modes.length > 1 ? "hidden sm:inline-flex" : "inline-flex"}>
              <Avatar name={user.fullName ?? user.email} src={profilePhotoUrl} size="md" tone="accent"
                alt={profilePhotoUrl ? t("athletePhoto.alt", { name: user.fullName ?? user.email }) : undefined} />
            </span>
          )}
          <SignOutButton />
        </div>
      </header>
      {subHeader}

      <main id="main" tabIndex={-1} className="flex-1 px-4 pb-28 pt-5 focus:outline-none">
        {children}
      </main>

      {/* "More" sheet for overflow destinations */}
      {moreOpen && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={t("shell.more")}>
          <div className="absolute inset-0 animate-fade-in bg-black/60" onClick={closeMore} />
          <div className="safe-bottom absolute inset-x-0 bottom-0 mx-auto max-w-2xl animate-fade-up rounded-t-xl border border-b-0 border-border bg-bg-secondary p-3 pb-20 shadow-lg">
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="eyebrow">{t("shell.more")}</span>
              <button onClick={closeMore} aria-label={t("common.close")} className={iconBtn} autoFocus>
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <ul className="grid grid-cols-3 gap-2">
              {extra.map((item) => (
                <li key={item.href}>
                  <TabLink item={item} active={isActive(item.href, item.aliases)} onClick={closeMore} tile />
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2.5 border-t border-border px-2 pt-3">
              <Avatar name={user.fullName ?? user.email} size="sm" tone="accent" />
              <span className="truncate text-xs text-text-muted">{user.email}</span>
            </div>
          </div>
        </div>
      )}

      {/* Bottom tab bar */}
      <nav
        aria-label={t("shell.mainNavigation")}
        className="safe-bottom fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl border-t border-border bg-bg-secondary/95 backdrop-blur"
      >
        <ul className="flex h-16 items-stretch">
          {primary.map((item) => (
            <li key={item.href} className="flex flex-1">
              <TabLink item={item} active={isActive(item.href, item.aliases)} />
            </li>
          ))}
          {overflow && (
            <li className="flex flex-1">
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                aria-expanded={moreOpen}
                className={cn(
                  "touch-target relative flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus",
                  moreOpen || extraActive ? "text-brand-primary" : "text-text-muted hover:text-text",
                )}
              >
                <MoreHorizontal className="h-5 w-5" aria-hidden />
                {t("shell.more")}
              </button>
            </li>
          )}
        </ul>
      </nav>
    </div>
  );
}

function TabLink({
  item: { labelKey, href, icon: Icon },
  active,
  onClick,
  tile,
}: {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
  tile?: boolean;
}) {
  const navLabel = useNavLabel();
  return (
    <Link
      href={href as never}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "touch-target relative flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus",
        tile && "rounded-md border border-border bg-surface py-3.5 text-xs",
        active ? "text-brand-primary" : "text-text-muted hover:text-text",
        tile && active && "border-brand-primary/40 bg-brand-primary-soft",
      )}
    >
      {active && !tile && (
        <span aria-hidden className="absolute inset-x-1/4 top-0 h-0.5 rounded-full bg-brand-primary shadow-glow" />
      )}
      <Icon className="h-5 w-5" aria-hidden />
      <span className="max-w-full truncate px-1">{navLabel(labelKey)}</span>
    </Link>
  );
}
