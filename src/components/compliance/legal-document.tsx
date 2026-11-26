import Link from "next/link";
import type { LegalDocKey, LegalDocument } from "@/lib/compliance/legal-templates";
import { LEGAL_DOCS, LEGAL_DOC_TITLES } from "@/lib/compliance/legal-templates";
import { CookieSettingsButton } from "./cookie-consent-banner";

/** Renders a structured legal document. Text only — no HTML from tenants. */
export function LegalDocumentView({ doc, showAdminHints = false }: { doc: LegalDocument; showAdminHints?: boolean }) {
  return (
    <article className="space-y-8">
      <header className="space-y-2 border-b border-line pb-6">
        <h1 className="font-display text-3xl font-semibold text-ink">{doc.title}</h1>
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-3">Last updated {doc.lastUpdated}</p>
        <p className="text-ink-2">{doc.intro}</p>
      </header>

      {showAdminHints && doc.missingFields.length > 0 && (
        <div className="rounded-md border border-warning bg-warning-soft p-3 text-sm text-ink">
          Missing club details: {doc.missingFields.join(", ")}. Complete them in Settings → Privacy.
        </div>
      )}

      {doc.sections.map((s) => (
        <section key={s.id} id={s.id} className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-ink">{s.heading}</h2>
          {s.paragraphs.map((p, i) => (
            <p key={i} className="leading-relaxed text-ink-2">{p}</p>
          ))}
          {s.list && s.list.length > 0 && (
            <ul className="list-disc space-y-1.5 pl-5 text-ink-2">
              {s.list.map((li, i) => <li key={i}>{li}</li>)}
            </ul>
          )}
        </section>
      ))}

      <p className="border-t border-line pt-4 text-xs text-ink-3">{doc.reviewNotice}</p>
    </article>
  );
}

export function LegalNav({ slug, active }: { slug: string; active?: LegalDocKey }) {
  return (
    <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {LEGAL_DOCS.map((k) => (
        <Link
          key={k}
          href={`/legal/${slug}/${k}`}
          className={k === active ? "text-maroon" : "text-ink-2 hover:text-ink"}
          aria-current={k === active ? "page" : undefined}
        >
          {LEGAL_DOC_TITLES[k]}
        </Link>
      ))}
    </nav>
  );
}

/** Drop-in footer for public pages (registration, camp pages, login). */
export function LegalFooter({ slug, className }: { slug: string; className?: string }) {
  return (
    <footer className={className ?? "border-t border-line px-4 py-6 text-xs text-ink-3"}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2">
        {LEGAL_DOCS.map((k) => (
          <Link key={k} href={`/legal/${slug}/${k}`} className="hover:text-ink">{LEGAL_DOC_TITLES[k]}</Link>
        ))}
        <CookieSettingsButton className="hover:text-ink" />
      </div>
    </footer>
  );
}
