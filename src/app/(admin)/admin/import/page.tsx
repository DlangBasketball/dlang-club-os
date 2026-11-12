import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { PageHeader, Button, Card, CardBody } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { TEMPLATE_COLUMNS, MAX_ROWS } from "./csv";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const me = await getSessionUser();
  if (!me?.roles.includes("admin")) redirect("/admin/dashboard");

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title="Import families & athletes"
        description="Bring a club's existing roster in from a spreadsheet: one row per athlete, with the household and guardians repeated on each row."
        actions={
          <Link href="/admin/import/template" prefetch={false}>
            <Button variant="secondary"><Download className="h-4 w-4" /> CSV template</Button>
          </Link>
        }
      />

      <Card className="max-w-2xl">
        <CardBody className="space-y-2 text-sm text-ink-2">
          <p>
            <strong className="text-ink">Required columns:</strong> athlete_first_name, athlete_last_name, athlete_dob. Everything else is optional.
          </p>
          <p>
            <strong className="text-ink">All columns:</strong> <span className="font-mono text-xs">{TEMPLATE_COLUMNS.join(", ")}</span>
          </p>
          <p>
            Rows with the same <span className="font-mono text-xs">family_ref</span> (or the same family name and first guardian email) become one household.
            Guardians receive a parent invitation; they are linked to the family automatically when they first sign in with that email.
            Athletes that already exist (same name and date of birth) are skipped, so re-running a corrected file is safe.
          </p>
          <p>
            Comma, semicolon or tab separated, UTF-8. Up to {MAX_ROWS} rows per file. Do <em>not</em> include medical information — collect it through the
            parent app so consent is recorded.
          </p>
        </CardBody>
      </Card>

      <ImportForm />
    </div>
  );
}
