import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        <Link href="/" className="font-mono text-xs uppercase tracking-[0.18em] text-ink-3 hover:text-ink">← Home</Link>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
