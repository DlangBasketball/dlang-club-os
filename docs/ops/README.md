# docs/ops — deployment & operations

Start here. Everything needed to deploy, run and recover the platform in CH, the EU and the US.

| Document | Use it when |
|---|---|
| [ARCHITECTURE_DEPLOYMENT.md](ARCHITECTURE_DEPLOYMENT.md) | Understanding regions, tenant -> region routing, domains, email sender domains, environments |
| [DEPLOY.md](DEPLOY.md) | Go-live plan with dated milestones (DLang first), one-time setup, deploying the app |
| [MIGRATIONS.md](MIGRATIONS.md) | Writing or applying any SQL migration |
| [BACKUP_DR.md](BACKUP_DR.md) | Backups, PITR, RPO/RTO, restore drills, disaster scenarios |
| [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) | Something is broken or data may have leaked (72 h GDPR / FDPIC duties) |
| [ONCALL.md](ONCALL.md) | Alerts, paging, rotation, secret rotation |
| [TENANT_ONBOARDING_RUNBOOK.md](TENANT_ONBOARDING_RUNBOOK.md) | A new club signs: provision, domain, branding, Stripe Connect, CSV import |
| [CHANGELOG.md](CHANGELOG.md) | Log of ops changes, deploys, migrations, drills and incidents |

Tooling referenced by these docs:

* `GET /api/health` (+ `?probe=live`) — `src/app/api/health/route.ts`
* Logging / error reporting / env validation — `src/lib/observability/`
* `scripts/deploy/check-env.mjs` — pre-deploy env check
* `scripts/deploy/smoke-test.sh` — post-deploy smoke test
* `Dockerfile`, `.dockerignore`, `vercel.json`
* CSV importer — `src/app/(admin)/admin/import/` (Admin -> Import)
