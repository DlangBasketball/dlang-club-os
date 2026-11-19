import { PageHeader } from "@/components/ui";
import { SettingsNav } from "@/components/admin/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-fade-up">
      <PageHeader title="Settings" description="Club configuration, billing, staff, privacy and audit." />
      <SettingsNav />
      {children}
    </div>
  );
}
