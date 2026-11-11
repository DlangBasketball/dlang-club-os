"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/settings", label: "Club profile" },
  { href: "/admin/settings/branding", label: "Branding & venues" },
  { href: "/admin/settings/billing", label: "Billing & tax" },
  { href: "/admin/settings/staff", label: "Staff & roles" },
  { href: "/admin/settings/notifications", label: "Templates" },
  { href: "/admin/settings/privacy", label: "Privacy & data" },
  { href: "/admin/settings/audit", label: "Audit log" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-line">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link key={t.href} href={t.href as never}
            className={cn("rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors", active ? "border-maroon text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
