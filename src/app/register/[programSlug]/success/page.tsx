import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card, CardBody, Button } from "@/components/ui";
import { getPublicProgram } from "@/lib/data/public-registration";

export default async function RegistrationSuccessPage({
  params, searchParams,
}: {
  params: Promise<{ programSlug: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { programSlug } = await params;
  const { ref } = await searchParams;
  const data = await getPublicProgram(programSlug);
  const programName = data?.program.name ?? "the program";

  return (
    <div className="animate-fade-up py-6">
      <Card className="mx-auto max-w-lg">
        <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold">Registration received</h1>
            <p className="mt-2 text-sm text-ink-2">
              Thanks for registering for <span className="text-ink">{programName}</span>. We&apos;ve emailed you a confirmation
              {ref ? <> with invoice <span className="tnum text-ink">{ref}</span></> : null}.
            </p>
          </div>
          <div className="w-full rounded-md border border-line bg-surface-elevated/50 p-4 text-left text-sm text-ink-2">
            <p className="font-medium text-ink">What happens next</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>A club admin reviews and confirms your spot.</li>
              <li>You&apos;ll get an email to set up your parent account.</li>
              <li>Pay the invoice from your account (card, TWINT or bank transfer).</li>
            </ol>
          </div>
          <Link href="/login"><Button>Set up your account</Button></Link>
        </CardBody>
      </Card>
    </div>
  );
}
