import { getTemplateOverrides } from "@/lib/data/settings";
import { TemplateEditor } from "@/components/admin/settings-templates";

export default async function TemplatesPage() {
  const overrides = await getTemplateOverrides();
  return <TemplateEditor overrides={overrides} />;
}
