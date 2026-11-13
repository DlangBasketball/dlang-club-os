import { requireRole } from "@/lib/auth/get-user";
import { TemplatePage } from "@/components/development/pages";
import { SportTagPicker } from "@/components/sports/sports-manager";
import { assessmentSportId, sportOptions } from "@/lib/sports/data";

/** Admins only: finance has no access to children's development data. */
export default async function TemplateRoute({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole(["admin"]);
  const { id } = await params;
  const isUuid = /^[0-9a-f-]{36}$/i.test(id);
  const [sports, sportId] = me.orgId && isUuid ? await Promise.all([sportOptions(me.orgId), assessmentSportId(id)]) : [[], null];
  return (
    <div className="space-y-4">
      {isUuid && <SportTagPicker kind="assessment" recordId={id} value={sportId} sports={sports} />}
      <TemplatePage base="/admin/development" isAdmin={true} id={id} />
    </div>
  );
}
