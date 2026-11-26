"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Info, ShieldCheck, Sparkles } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { APP_NAME_MAX, appNameError, sanitizeAppName } from "@/lib/tenant/app-name";
import { saveAppDisplayName, setAiAssistantEnabled, type AppSettingsResult } from "@/lib/actions/app-settings";
import type { AssistantState } from "@/lib/ai/access";

type Msg = { ok: boolean; text: string } | null;

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  async function run(fn: () => Promise<AppSettingsResult>) {
    setBusy(true);
    setMsg(null);
    const res = await fn();
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  return { busy, msg, run };
}

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <span role="status" className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>
      {msg.text}
    </span>
  );
}

/** Settings → App & assistant: the club's app display name and the AI assistant opt-in. */
export function AppSettingsForm({
  orgName,
  appName,
  assistant,
  canEdit,
}: {
  orgName: string;
  appName: string;
  assistant: AssistantState;
  canEdit: boolean;
}) {
  const t = useT();
  const [name, setName] = React.useState(appName);
  const nameSaver = useAction();
  const aiSaver = useAction();

  const problem = appNameError(name);
  const preview = sanitizeAppName(name) ?? orgName;
  const clientError =
    problem === "tooLong"
      ? t("appSettings.appName.errorTooLong", { max: APP_NAME_MAX })
      : problem === "invalidChars"
        ? t("appSettings.appName.errorInvalidChars")
        : null;

  const canEnable = assistant.configured && assistant.entitled;
  const on = assistant.enabled && canEnable;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("appSettings.appName.title")}</CardTitle>
        </CardHeader>
        <CardBody>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!clientError) nameSaver.run(() => saveAppDisplayName(name));
            }}
          >
            <p className="text-sm text-ink-3">{t("appSettings.appName.description")}</p>
            <div>
              <Label htmlFor="app-name">{t("appSettings.appName.label")}</Label>
              <Input
                id="app-name"
                value={name}
                maxLength={APP_NAME_MAX + 20}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("appSettings.appName.placeholder", { example: orgName })}
                disabled={!canEdit}
                aria-invalid={clientError ? true : undefined}
                aria-describedby="app-name-hint"
              />
              <p id="app-name-hint" className="mt-1 text-xs text-ink-4">
                {clientError ?? `${t("appSettings.appName.maxHint", { max: APP_NAME_MAX })} ${t("appSettings.appName.preview", { name: preview })}`}
              </p>
            </div>
            {canEdit && (
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={nameSaver.busy || Boolean(clientError)}>
                  {nameSaver.busy ? t("common.saving") : t("appSettings.appName.save")}
                </Button>
                <Status msg={nameSaver.msg} />
              </div>
            )}
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("appSettings.ai.title")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{t("appSettings.ai.addon.badge")}</Badge>
            <Badge tone={on ? "success" : "neutral"} dot>
              {on ? t("appSettings.ai.statusOn") : t("appSettings.ai.statusOff")}
            </Badge>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-ink-3">{t("appSettings.ai.description")}</p>
          <p className="text-xs text-ink-4">{t("appSettings.ai.whoCanUse")}</p>

          <p className="flex items-start gap-2 rounded-md border border-line bg-surface-elevated p-3 text-xs text-ink-3" role="note">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t("appSettings.ai.processingNotice")}
          </p>

          {!assistant.configured && (
            <p className="flex items-center gap-2 text-sm text-ink-3">
              <Info className="h-4 w-4" aria-hidden /> {t("appSettings.ai.unconfigured")}
            </p>
          )}
          {/* Paid add-on, not part of any plan: discoverable here even when not entitled. */}
          {!assistant.entitled && (
            <div className="flex items-start gap-2 rounded-md border border-line bg-surface-elevated p-3 text-sm text-ink-3" role="note">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="space-y-1">
                <p className="font-medium text-ink">{t("appSettings.ai.addon.notIncluded")}</p>
                <p>{t("appSettings.ai.addon.onRequest")}</p>
              </div>
            </div>
          )}
          {assistant.entitled && assistant.addonSource && (
            <p className="flex items-center gap-2 text-sm text-ink-3">
              <Info className="h-4 w-4" aria-hidden />{" "}
              {assistant.addonSource === "complimentary" ? t("appSettings.ai.addon.complimentary") : t("appSettings.ai.addon.paid")}
            </p>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              {on ? (
                <Button variant="secondary" disabled={aiSaver.busy} onClick={() => aiSaver.run(() => setAiAssistantEnabled(false))}>
                  {aiSaver.busy ? t("common.saving") : t("appSettings.ai.turnOff")}
                </Button>
              ) : (
                <Button
                  disabled={aiSaver.busy || !canEnable}
                  aria-label={t("appSettings.ai.toggleLabel")}
                  onClick={() => aiSaver.run(() => setAiAssistantEnabled(true))}
                >
                  {aiSaver.busy ? t("common.saving") : t("appSettings.ai.turnOn")}
                </Button>
              )}
              {/* An admin can always turn a stale "on" flag off, even after a plan change. */}
              {!on && assistant.enabled && (
                <Button variant="secondary" disabled={aiSaver.busy} onClick={() => aiSaver.run(() => setAiAssistantEnabled(false))}>
                  {t("appSettings.ai.turnOff")}
                </Button>
              )}
              <Status msg={aiSaver.msg} />
            </div>
          )}
          <p className="text-xs text-ink-4">{t("appSettings.ai.auditNote")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
