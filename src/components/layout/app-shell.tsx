"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { NAV, type NavKey } from "./nav-config";
import { BrandMark } from "./brand-mark";
import type { SessionUser } from "@/lib/auth/get-user";
import { cn, initials } from "@/lib/utils";
import { NotificationBell } from "./notification-bell";
import type { NavNotification } from "@/lib/data/notifications";
import { useT } from "@/lib/i18n/client";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

type NotifProp = { data: { items: NavNotification[]; unread: number }; viewAllHref?: string } | undefined;

/**
 * App layout shell.
 *  - variant "sidebar" (admin/finance): fixed left rail on desktop, drawer on mobile.
 *  - variant "bottom"  (coach/parent): mobile-first with a bottom tab bar.
 */
export function AppShell({
  navKey,
  user,
  notifications,
  children,
}: {
  navKey: NavKey;
  user: SessionUser;
  notifications?: NotifProp;
  children: React.ReactNode;
}) {
  const variant = navKey === "admin" ? "sidebar" : "bottom";
  return variant === "sidebar" ? (
    <SidebarShell navKey={navKey} user={user} notifications={notifications}>
      {children}
    </SidebarShell>
  ) : (
    <BottomShell navKey={navKey} user={user} notifications={notifications}>
      {children}
    </BottomShell>
  );
}

function NavLinks({
  navKey,
  onNavigate,
}: {
  navKey: NavKey;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav className="flex flex-col gap-1" aria-label={t("shell.mainNavigation")}>
      {NAV[navKey].map(({ labelKey, href, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href as never}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
              active
                ? "bg-maroon-soft text-inverse"
                : "text-ink-2 hover:bg-surface-elevated hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {t(`nav.${labelKey}`)}
            {active && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-maroon" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 border-t border-line-soft p-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-elevated text-xs font-semibold text-ink">
        {initials(user.fullName ?? user.email)}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm text-ink">
          {user.fullName ?? t("shell.member")}
        </div>
        <div className="truncate text-xs text-ink-3">{user.email}</div>
      </div>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          aria-label={t("shell.signOut")}
          title={t("shell.signOut")}
          className="rounded p-2 text-ink-3 transition-colors hover:bg-surface-elevated hover:text-danger"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

function SidebarShell({
  navKey,
  user,
  notifications,
  children,
}: {
  navKey: NavKey;
  user: SessionUser;
  notifications?: NotifProp;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const t = useT();
  return (
    <div className="grain min-h-dvh bg-bg lg:grid lg:grid-cols-[260px_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden border-r border-line bg-bg-secondary lg:flex lg:flex-col">
        <div className="p-5">
          <BrandMark />
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <NavLinks navKey={navKey} />
        </div>
        <UserMenu user={user} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-line bg-bg-secondary">
            <div className="flex items-center justify-between p-5">
              <BrandMark />
              <button onClick={() => setOpen(false)} aria-label={t("shell.closeMenu")}>
                <X className="h-5 w-5 text-ink-2" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3">
              <NavLinks navKey={navKey} onNavigate={() => setOpen(false)} />
            </div>
            <UserMenu user={user} />
          </aside>
        </div>
      )}

      <div className="flex min-h-dvh flex-col">
        {/* Desktop topbar */}
        <header className="hidden items-center justify-end gap-2 border-b border-line bg-bg-secondary px-10 py-2.5 lg:flex">
          <LanguageSwitcher variant="compact" />
          {notifications && <NotificationBell initial={notifications.data} viewAllHref={notifications.viewAllHref} />}
        </header>
        {/* Mobile topbar */}
        <header className="flex items-center justify-between border-b border-line bg-bg-secondary px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label={t("shell.openMenu")}>
            <Menu className="h-5 w-5 text-ink-2" />
          </button>
          <BrandMark compact />
          <div className="flex items-center gap-1">
            <LanguageSwitcher variant="compact" />
            {notifications ? <NotificationBell initial={notifications.data} viewAllHref={notifications.viewAllHref} /> : <div className="w-5" />}
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
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
  children,
}: {
  navKey: NavKey;
  user: SessionUser;
  notifications?: NotifProp;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useT();
  return (
    <div className="grain mx-auto flex min-h-dvh max-w-2xl flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-line bg-bg-secondary px-4 py-3">
        <BrandMark compact />
        <div className="flex items-center gap-1">
          <LanguageSwitcher variant="compact" />
          {notifications && <NotificationBell initial={notifications.data} viewAllHref={notifications.viewAllHref} />}
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            aria-label={t("shell.signOut")}
            title={t("shell.signOut")}
            className="flex items-center gap-2 rounded p-2 text-xs text-ink-3 hover:text-danger"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 pb-24">{children}</main>

      {/* Bottom tab bar */}
      <nav aria-label={t("shell.mainNavigation")} className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-2xl items-stretch border-t border-line bg-bg-secondary/95 backdrop-blur">
        {NAV[navKey].map(({ labelKey, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href as never}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-3 text-[11px] transition-colors",
                active ? "text-maroon" : "text-ink-3 hover:text-ink-2",
              )}
            >
              <Icon className="h-5 w-5" />
              {t(`nav.${labelKey}`)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
