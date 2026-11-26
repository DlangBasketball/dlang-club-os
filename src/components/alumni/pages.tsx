import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, GraduationCap, Pencil, Plus, Upload } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, StatCard, StatGrid } from "@/components/ui";
import { Input, Select } from "@/components/ui/input";
import { getI18n } from "@/lib/i18n/server";
import {
  ALUMNI_BASE, getAlumniAccess, getAlumniDetail, listAlumni, listCoachAccess, listPhotoOptions, type AlumniApp,
} from "@/lib/alumni/data";
import {
  ALUMNI_STATUSES, INSTITUTION_TYPES, countAlumni, filterAlumni, filterOptions, isMinor, parseFilters, showcaseEligible, uuid,
} from "@/lib/alumni/rules";
import { AlumniForm } from "./alumni-form";
import { ContactCard, ContactLog, DeleteAlumniButton, PLACEMENT_TONE, PlacementTimeline } from "./profile-panels";
import { AlumniImportForm, CoachAccessCard } from "./tools";

async function access() {
  const a = await getAlumniAccess();
  if (!a) notFound();
  return a;
}

const STATUS_TONE = { active: "success", lost_touch: "warning", do_not_contact: "danger" } as const;

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export async function AlumniListPage({ app, searchParams }: { app: AlumniApp; searchParams: Record<string, string | string[] | undefined> }) {
  const { me, isAdmin } = await access();
  const { t, f } = await getI18n();
  const base = ALUMNI_BASE[app];
  const today = new Date().toISOString().slice(0, 10);
  const all = await listAlumni(me.orgId);
  const filters = parseFilters(searchParams);
  const rows = filterAlumni(all, filters, today);
  const counts = countAlumni(all, today);
  const opts = filterOptions(all);
  const coaches = isAdmin && app === "admin" ? await listCoachAccess(me.orgId) : [];
  const filtered = Boolean(filters.q || filters.type || filters.country || filters.gradYear || filters.status || filters.followUp);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        title={t("alumni.title")}
        description={t("alumni.description")}
        actions={(
          <>
            <Link href={`${base}/new` as never}><Button size="sm"><Plus className="h-4 w-4" aria-hidden /> {t("alumni.add")}</Button></Link>
            <Link href={`${base}/import` as never}><Button size="sm" variant="secondary"><Upload className="h-4 w-4" aria-hidden /> {t("alumni.import.button")}</Button></Link>
            <a href={`${base}/export`}><Button size="sm" variant="secondary"><Download className="h-4 w-4" aria-hidden /> {t("alumni.export")}</Button></a>
          </>
        )}
      />

      <StatGrid>
        <StatCard label={t("alumni.counts.total")} value={f.number(counts.total)} accent />
        {counts.groups.map((g) => (
          <StatCard key={g.key} label={t(`alumni.groups.${g.key}`)} value={f.number(g.count)}
            href={g.key === "schools" || g.key === "pro" || g.key === "clubs" ? undefined : `${base}?type=${g.key}`} />
        ))}
        {counts.followUpsDue > 0 && <StatCard label={t("alumni.counts.followUpsDue")} value={f.number(counts.followUpsDue)} tone="warning" href={`${base}?followUp=1`} />}
      </StatGrid>
      {counts.groups.length > 0 && (
        <p className="text-sm text-text-muted">{counts.groups.map((g) => t("alumni.counts.line", { count: g.count, group: t(`alumni.groups.${g.key}`) })).join(" · ")}</p>
      )}

      <Card>
        <CardBody>
          <form method="get" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" role="search" aria-label={t("alumni.filters.label")}>
            <Input name="q" defaultValue={filters.q ?? ""} placeholder={t("alumni.filters.search")} aria-label={t("alumni.filters.search")} className="lg:col-span-2" />
            <Select name="type" defaultValue={filters.type ?? ""} aria-label={t("alumni.filters.type")}>
              <option value="">{t("alumni.filters.allTypes")}</option>
              {INSTITUTION_TYPES.map((k) => <option key={k} value={k}>{t(`alumni.types.${k}`)}</option>)}
            </Select>
            <Select name="country" defaultValue={filters.country ?? ""} aria-label={t("alumni.filters.country")}>
              <option value="">{t("alumni.filters.allCountries")}</option>
              {opts.countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select name="year" defaultValue={filters.gradYear ? String(filters.gradYear) : ""} aria-label={t("alumni.filters.gradYear")}>
              <option value="">{t("alumni.filters.allYears")}</option>
              {opts.years.map((y) => <option key={y} value={y}>{t("alumni.placement.classOf", { year: y })}</option>)}
            </Select>
            <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("alumni.filters.status")}>
              <option value="">{t("alumni.filters.allStatuses")}</option>
              {ALUMNI_STATUSES.map((s) => <option key={s} value={s}>{t(`alumni.statuses.${s}`)}</option>)}
            </Select>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" name="followUp" value="1" defaultChecked={filters.followUp} /> {t("alumni.filters.followUpDue")}
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" variant="secondary">{t("alumni.filters.apply")}</Button>
              {filtered && <Link href={base as never}><Button type="button" size="sm" variant="ghost">{t("alumni.filters.clear")}</Button></Link>}
            </div>
          </form>
        </CardBody>
      </Card>

      {all.length === 0 ? (
        <EmptyState icon={<GraduationCap className="h-6 w-6" />} title={t("alumni.empty.title")} description={t("alumni.empty.body")} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t("alumni.filters.noMatch")}</p>
      ) : (
        <Card>
          <CardHeader><CardTitle>{t("alumni.list.count", { count: rows.length })}</CardTitle></CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`${base}/${r.id}` as never} className="font-medium text-text hover:text-brand-primary">{r.first_name} {r.last_name}</Link>
                    <p className="truncate text-xs text-text-muted">
                      {r.current
                        ? [r.current.institution, t(`alumni.types.${r.current.institution_type}`), r.current.country, r.current.end_year ? t("alumni.placement.classOf", { year: r.current.end_year }) : null].filter(Boolean).join(" · ")
                        : t("alumni.placement.none")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.current && <Badge tone={PLACEMENT_TONE[r.current.status] ?? "neutral"}>{t(`alumni.placementStatuses.${r.current.status}`)}</Badge>}
                    {r.status !== "active" && <Badge tone={STATUS_TONE[r.status]}>{t(`alumni.statuses.${r.status}`)}</Badge>}
                    {r.follow_up_on && (
                      <Badge tone={r.follow_up_on <= today ? "warning" : "neutral"}>{t("alumni.contact.followUpValue", { date: f.date(r.follow_up_on) })}</Badge>
                    )}
                    {r.last_contact_at && <span className="text-xs text-text-muted">{t("alumni.list.lastContact", { when: f.relative(r.last_contact_at) })}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {coaches.length > 0 && <CoachAccessCard coaches={coaches} />}
      <p className="text-xs text-text-muted">{t("alumni.privacyNote")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export async function AlumniProfilePage({ app, id }: { app: AlumniApp; id: string }) {
  if (!uuid.safeParse(id).success) notFound();
  const { me } = await access();
  const { t, f } = await getI18n();
  const base = ALUMNI_BASE[app];
  const d = await getAlumniDetail(me.orgId, id);
  if (!d) notFound();
  const a = d.alumni;
  const name = `${a.first_name} ${a.last_name}`;
  const today = new Date().toISOString().slice(0, 10);
  const minor = isMinor({ birthYear: a.birth_year, birthDate: a.birth_date });
  const showcase = showcaseEligible({
    firstName: a.first_name, lastName: a.last_name, birthYear: a.birth_year, birthDate: a.birth_date, showcaseConsent: a.showcase_consent,
    showcaseGuardianConsent: a.showcase_guardian_consent, showcaseNameStyle: a.showcase_name_style, status: a.status,
  });
  const facts: [string, string | null][] = [
    [t("alumni.fields.birthYear"), a.birth_date ? f.date(a.birth_date) : a.birth_year ? String(a.birth_year) : null],
    [t("alumni.fields.gender"), a.gender ? t(`alumni.genders.${a.gender as "female"}`) : null],
    [t("alumni.fields.nationality"), a.nationality],
    [t("alumni.fields.guardianName"), [a.guardian_name, a.guardian_email, a.guardian_phone].filter(Boolean).join(" · ") || null],
    [t("alumni.fields.contactConsent"), a.contact_consent
      ? t("alumni.profile.consentYes", { date: a.contact_consent_on ? f.date(a.contact_consent_on) : "—", source: a.contact_consent_source ?? "—" })
      : t("alumni.profile.consentNo")],
    [t("alumni.fields.showcaseConsent"), a.showcase_consent
      ? t(showcase ? "alumni.profile.showcaseOn" : "alumni.profile.showcaseBlocked", { date: a.showcase_consent_on ? f.date(a.showcase_consent_on) : "—" })
      : t("alumni.profile.consentNo")],
    [t("alumni.fields.tags"), a.tags.length ? a.tags.join(", ") : null],
  ];
  return (
    <div className="animate-fade-up max-w-5xl space-y-5">
      <PageHeader
        eyebrow={<Link href={base as never} className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t("alumni.title")}</Link>}
        title={(
          <span className="flex flex-wrap items-center gap-3">
            {d.photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.photoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
            )}
            {name}
            <Badge tone={STATUS_TONE[a.status]}>{t(`alumni.statuses.${a.status}`)}</Badge>
            {minor && <Badge tone="warning">{t("alumni.profile.minor")}</Badge>}
          </span>
        )}
        actions={(
          <>
            <Link href={`${base}/${a.id}/edit` as never}><Button size="sm" variant="secondary"><Pencil className="h-4 w-4" aria-hidden /> {t("common.edit")}</Button></Link>
            <a href={`${base}/${a.id}/export`}><Button size="sm" variant="secondary"><Download className="h-4 w-4" aria-hidden /> {t("alumni.dsar.export")}</Button></a>
            <DeleteAlumniButton id={a.id} name={name} redirectTo={base} />
          </>
        )}
      />
      {d.athlete && app === "admin" && (
        <p className="text-sm text-text-muted">
          {t(d.athlete.archived ? "alumni.profile.linkedArchived" : "alumni.profile.linkedPlayer")}{" "}
          {!d.athlete.archived && <Link href={`/admin/athletes/${d.athlete.id}` as never} className="text-brand-primary hover:underline">{d.athlete.name}</Link>}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <ContactCard
            alumniId={a.id}
            person={{
              firstName: a.first_name, lastName: a.last_name, birthYear: a.birth_year, birthDate: a.birth_date, email: a.email, phone: a.phone,
              whatsapp: a.whatsapp, guardianName: a.guardian_name, guardianEmail: a.guardian_email, guardianPhone: a.guardian_phone,
              contactConsent: a.contact_consent, status: a.status,
            }}
            socials={{ instagram: a.instagram, xHandle: a.x_handle, linkedinUrl: a.linkedin_url, highlightUrl: a.highlight_url }}
          />
          <Card>
            <CardHeader><CardTitle>{t("alumni.profile.details")}</CardTitle></CardHeader>
            <CardBody>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {facts.map(([label, value]) => (
                  <div key={label} className="rounded-md bg-surface-elevated px-3 py-2">
                    <dt className="text-xs text-text-muted">{label}</dt>
                    <dd className="text-text">{value?.trim() ? value : "—"}</dd>
                  </div>
                ))}
              </dl>
              {a.notes && <p className="mt-3 whitespace-pre-line text-sm text-text-secondary">{a.notes}</p>}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-5">
          <PlacementTimeline alumniId={a.id} placements={d.placements} />
          <ContactLog alumniId={a.id} contacts={d.contacts} today={today} />
        </div>
      </div>
      <p className="text-xs text-text-muted">{t("alumni.dsar.note")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New / edit / import
// ---------------------------------------------------------------------------
export async function AlumniEditPage({ app, id }: { app: AlumniApp; id?: string }) {
  const { me, isAdmin } = await access();
  const { t } = await getI18n();
  const base = ALUMNI_BASE[app];
  let initial = null;
  if (id) {
    if (!uuid.safeParse(id).success) notFound();
    const d = await getAlumniDetail(me.orgId, id);
    if (!d) notFound();
    initial = d.alumni;
  }
  const photos = isAdmin ? await listPhotoOptions(me.orgId) : [];
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader
        eyebrow={<Link href={(id ? `${base}/${id}` : base) as never} className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t("alumni.title")}</Link>}
        title={initial ? `${initial.first_name} ${initial.last_name}` : t("alumni.add")}
        description={t("alumni.form.description")}
      />
      <AlumniForm base={base} initial={initial} photos={photos} />
    </div>
  );
}

export async function AlumniImportPage({ app }: { app: AlumniApp }) {
  await access();
  const { t, f } = await getI18n();
  const base = ALUMNI_BASE[app];
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader
        eyebrow={<Link href={base as never} className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t("alumni.title")}</Link>}
        title={t("alumni.import.title")}
      />
      <AlumniImportForm base={base} defaultOrder={f.dateOrder() === "MDY" ? "MDY" : "DMY"} />
      <Card>
        <CardHeader><CardTitle>{t("alumni.import.columnsTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-2 text-sm text-text-secondary">
          <p>{t("alumni.import.columnsBody")}</p>
          <p>{t("alumni.import.typesBody")}</p>
          <p>{t("alumni.import.minorsBody")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
