# Smokejumper

[![CI](https://github.com/artinrexhepii/smokejumper/actions/workflows/ci.yml/badge.svg)](https://github.com/artinrexhepii/smokejumper/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D20.9-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

**The open-source AI incident copilot.** When an alert fires, an AI agent
investigates it the way a senior on-call engineer would — pulls logs, checks
infrastructure state, correlates symptoms across services — and delivers a
diagnosis with cited evidence to your dashboard in minutes, before a human
opens a laptop.

Smokejumpers are the firefighters who parachute in ahead of everyone else,
scout the fire, and report back. Same job.

- **Self-hosted.** Your telemetry never leaves your infrastructure. The only
  egress is the LLM API — and even that is optional (see the demo below).
- **Evidence or silence.** Every diagnosis claim cites immutable, hash-chained
  evidence records, or is explicitly labeled an unverified hypothesis.
- **Read-only.** The agent can look at anything and change nothing. Zero
  adoption risk.
- **Pluggable everywhere.** Alert sources, telemetry sources, and notification
  sinks are adapters against a stable SDK. The core doesn't know what
  "Sentry" is — it knows contracts.

## How it works

```mermaid
flowchart LR
  A["Alert sources<br/>webhook · Sentry"] -->|normalize + dedup| B["Core server<br/>incidents · evidence · audit"]
  B --> C["Investigation engine<br/>triage → plan → specialists → synthesis"]
  C -->|read-only tools| D["Telemetry sources<br/>Docker · HTTP · GitHub deploys"]
  B --> E[("Postgres + pgvector")]
  B -->|live trace| F["Dashboard"]
  B --> G["Notification sinks<br/>Slack"]
```

## The 5-minute demo

The repo ships its own fire to fight: a tiny shop (two services), a watchdog
that acts as your monitoring system, and a chaos CLI. You break the shop; the
watchdog notices real symptoms and fires an alert; Smokejumper investigates
while you watch the live trace.

No Anthropic API key needed: the default `.env` enables
`SMOKEJUMPER_FAKE_MODEL=1`, which runs the full investigation pipeline with
deterministic scripted model responses, entirely offline.

```bash
git clone https://github.com/artinrexhepii/smokejumper && cd smokejumper
cp .env.example .env && echo "SMOKEJUMPER_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
docker compose -f docker-compose.yml -f demo/docker-compose.yml up -d --build
```

Open <http://localhost:3000> and log in as `admin@example.com` /
`smokejumper`. Seeding is automatic — the org, project, and demo plugin
instances are created on first start.

Now break something:

```bash
pnpm install        # once, for the chaos CLI
pnpm chaos error-storm
```

(No Node on this machine? `curl -X POST localhost:3401/chaos/error-storm`
does the same thing.)

Within ~15 seconds the shop's error rate degrades, the watchdog fires a
webhook alert, an incident opens in the dashboard, and the live investigation
trace starts streaming. When the diagnosis card appears, judge it — confirm
or reject feeds the project's memory. Then heal the shop:

```bash
pnpm chaos reset
```

| Scenario | What breaks |
|---|---|
| `error-storm` | `/products` returns 500s; error rate degrades |
| `dependency-outage` | calls to the pricing worker time out; 502s |
| `latency` | `/products` takes 2–5s; health degrades on latency |
| `oom` | shop-api leaks memory until Docker OOM-kills it (256MB limit) and restarts it clean |
| `reset` | clears every injected failure |

The watchdog detects **symptoms** (error rates and latency derived from real
request outcomes, or an unreachable service), never the chaos switch itself —
what Smokejumper investigates is exactly what your monitoring would see.

### Real diagnoses

Set in `.env`:

```bash
SMOKEJUMPER_FAKE_MODEL=
ANTHROPIC_API_KEY=sk-ant-...
```

then `docker compose -f docker-compose.yml -f demo/docker-compose.yml up -d server`
to restart the server. The same chaos scenarios now get real model
investigations, including Docker container inspection through the bundled
read-only socket proxy.

### Running the core without the demo

`docker compose up -d --build` starts just Postgres, the server, the
dashboard, and the docker socket proxy. Seed the initial org and user with
`docker compose run --rm server node dist/seed.js`.

## Deploying to Kubernetes (Helm)

The `deploy/helm/smokejumper` chart deploys the full stack — server, dashboard,
Postgres/pgvector, a one-shot migration+seed Job, and a ServiceAccount with
**read-only** RBAC (`get`/`list`/`watch` on pods, pod logs, events, and
deployments) so an in-cluster Kubernetes telemetry instance needs no kubeconfig
and can change nothing.

```bash
helm install smokejumper deploy/helm/smokejumper \
  --set image.server.repository=ghcr.io/you/smokejumper-server \
  --set image.server.tag=latest \
  --set image.dashboard.repository=ghcr.io/you/smokejumper-dashboard \
  --set image.dashboard.tag=latest \
  --set encryptionKey="$(openssl rand -base64 32)" \
  --set publicBaseUrl=https://smokejumper.example.com \
  --set dashboardUrl=https://smokejumper.example.com \
  --wait
```

The migration+seed Job creates the initial org, user (`admin@example.com` /
`smokejumper`), and `demo` project on install.

| Value | Default | What |
|---|---|---|
| `image.server.{repository,tag}` | `smokejumper-server:latest` | server image |
| `image.dashboard.{repository,tag}` | `smokejumper-dashboard:latest` | dashboard image |
| `postgres.enabled` | `true` | bundle Postgres/pgvector; set `false` and fill `externalDatabase.url` to bring your own |
| `postgres.storage` | `8Gi` | PVC size for the bundled Postgres |
| `encryptionKey` / `existingSecret` | — | base64 32-byte key inline, or the name of a Secret holding an `encryption-key` key |
| `oidc.{enabled,issuer,clientId,clientSecret,defaultOrg}` | disabled | SSO; when disabled the server is password-only |
| `publicBaseUrl` | `http://localhost:3400` | externally-reachable server URL (OIDC redirect + alert ingest URLs) |
| `dashboardUrl` | `http://localhost:3000` | post-login redirect target |
| `dashboardOrigin` | `http://localhost:3000` | CORS/SSE allowed origin; only matters for a split-origin dashboard/API deploy |
| `secureCookies` | `false` | set `true` (or `--set secureCookies=true`) when the server is served over TLS |
| `ingress.{enabled,host}` | disabled | single-host Ingress: `/api`,`/ingest`,`/healthz` → server, `/` → dashboard |
| `replicaCount` | `1` | server/dashboard replicas |
| `resources` | `{}` | server/dashboard container resources |

Bring your own database:

```bash
helm install smokejumper deploy/helm/smokejumper \
  --set postgres.enabled=false \
  --set externalDatabase.url=postgres://user:pass@host:5432/smokejumper \
  --set encryptionKey="$(openssl rand -base64 32)"
```

The dashboard's `NEXT_PUBLIC_API_URL` is baked at image build time; for a
non-localhost install, rebuild the dashboard image with
`--build-arg NEXT_PUBLIC_API_URL=https://smokejumper.example.com`.

## Repository layout

| Path | What |
|---|---|
| `packages/plugin-sdk` | `@smokejumper/plugin-sdk` — the five plugin contracts, conformance suite, test fakes |
| `packages/db` | Postgres/pgvector data layer: incidents, hash-chained evidence, memory, audit |
| `packages/server` | Ingestion API, incident manager, REST + SSE |
| `packages/plugin-host` | Plugin registry, credential injection, read-only tool boundary |
| `packages/engine` | Mastra investigation workflow: triage → plan → specialists → synthesis |
| `plugins/*` | First-party adapters: webhook, Sentry, Docker, HTTP, GitHub deploys, Slack |
| `apps/dashboard` | Next.js dashboard: incident feed, live trace, diagnosis verdicts |
| `demo/` | The chaos harness you just ran |
| `deploy/helm/smokejumper` | Production Helm chart: full stack + read-only RBAC for the in-cluster Kubernetes adapter |

## Building a plugin

Adapters are stateless objects against `@smokejumper/plugin-sdk`; config and
host capabilities are injected per call, so plugins never hold credentials:

```ts
import type { AlertSource } from '@smokejumper/plugin-sdk'

export const myAlertSource: AlertSource<{ token: string }> = {
  manifest: { id: 'my-source', kind: 'alert-source', /* ... */ },
  async verify(req, config) {
    return req.headers['x-my-token'] === config.token
  },
  normalize(payload) {
    return { title, severity, service, labels, dedupKey, occurredAt, raw: payload }
  },
}
```

The SDK ships a conformance suite (`checkAlertSource`, `checkTelemetrySource`,
`checkNotificationSink`) — the same certification tests first-party adapters
pass. See `packages/plugin-sdk/README.md`.

## Roadmap

- **Phase 1 — Foundation (now):** core server, plugin SDK, six adapters,
  investigation engine, dashboard, this demo.
- **Phase 2 — Cloud-native:** CloudWatch, Kubernetes, Prometheus/Loki,
  Alertmanager; full plugin management UI; OIDC; Helm chart.
- **Phase 3 — Depth:** Datadog, Grafana, Elasticsearch, PagerDuty; runbook
  RAG; post-incident reviews; community plugin registry.
- **Phase 4 — Autonomy:** approval-gated remediation with a policy engine.

## Development

```bash
pnpm install
pnpm test        # everything runs offline, including the e2e acceptance test
pnpm typecheck
./demo/smoke.sh  # optional: full docker-compose smoke (needs docker)
```

## License

MIT © Smokejumper contributors
