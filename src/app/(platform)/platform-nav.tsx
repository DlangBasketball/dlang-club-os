"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Gauge, Layers, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/platform", label: "Overview", icon: Gauge, exact: true },
  { href: "/platform/tenants", label: "Tenants", icon: Building2, exact: false },
  { href: "/platform/plans", label: "Plans", icon: Layers, exact: false },
];

export function PlatformNav({ email }: { email: string | null }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <nav className="flex flex-row gap-1 overflow-x-auto lg:flex-col">
        {LINKS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href as never}
              className={cn(
                "flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2.5 text-sm transition-colors",
                active ? "bg-[#C19A45]/15 text-[#E4C77F]" : "text-ink-2 hover:bg-surface-elevated hover:text-ink",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto hidden border-t border-line-soft pt-4 lg:block">
        <div className="truncate px-3 text-xs text-ink-3">{email}</div>
        <form action="/auth/signout" method="post" className="mt-2">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-ink-3 hover:bg-surface-elevated hover:text-danger"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
