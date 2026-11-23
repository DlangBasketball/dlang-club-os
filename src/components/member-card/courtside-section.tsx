import type { ReactNode } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { loadCourtsideCard } from "@/lib/member-cards/courtside-data";
import { PhotoManager } from "@/components/athlete/photo-manager";
import { CourtsideDeck } from "./courtside-deck";
import { MemberCardPanel } from "./member-card-panel";

/**
 * Member card block for the parent app (own child), the admin athlete
 * profile and the player portal (own card, read-only). Shows the Courtside
 * card(s), the card photo controls (guardian / admin) and the existing card
 * tools (print, lost card, NFC). Without the member-card feature the
 * existing panel is shown unchanged (read-only views show nothing).
 *
 * `cardTitle`: wrap the block in its own titled Card (rendered only when
 * there is something to show).
 */
export async function CourtsideCardSection({
  athleteId, name, readOnly = false, pdfHref, admin = false, initialTag = null, cardTitle,
}: {
  athleteId: string;
  name: string;
  readOnly?: boolean;
  pdfHref?: string;
  admin?: boolean;
  initialTag?: string | null;
  cardTitle?: string;
}) {
  const [{ t }, res] = await Promise.all([getI18n(), loadCourtsideCard(athleteId)]);

  let body: ReactNode;
  if (!res.ok) {
    if (readOnly) return null;
    body = res.reason === "feature" && pdfHref
      ? <MemberCardPanel athleteId={athleteId} pdfHref={pdfHref} admin={admin} initialTag={initialTag} />
      : <p role="alert" className="text-sm text-danger">{t(res.reason === "forbidden" ? "memberCard.errors.forbidden" : "memberCard.errors.load")}</p>;
  } else {
    body = (
      <div className="space-y-5">
        <CourtsideDeck card={res.card} className="mx-auto sm:mx-0" />
        {!readOnly && (
          <>
            <PhotoManager athleteId={athleteId} name={name} photoUrl={res.card.photoUrl} variant="card" />
            {pdfHref && (
              <div className="border-t border-border pt-4">
                <MemberCardPanel athleteId={athleteId} pdfHref={pdfHref} admin={admin} initialTag={initialTag} />
              </div>
            )}
          </>
        )}
        {readOnly && <p className="text-xs text-text-muted">{t("memberCard.readOnlyHint")}</p>}
      </div>
    );
  }

  if (!cardTitle) return <>{body}</>;
  return (
    <Card>
      <CardHeader><CardTitle>{cardTitle}</CardTitle></CardHeader>
      <CardBody>{body}</CardBody>
    </Card>
  );
}
