# Contributing to Smokejumper

Thanks for your interest in improving Smokejumper. This guide covers how to get
the project running locally, the conventions the codebase follows, and how to
get a change merged.

## Ground rules

- Be respectful — see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Found a security issue? **Do not open a public issue** — follow the
  [Security Policy](SECURITY.md).
- Small, focused pull requests get reviewed and merged faster than large ones.

## Prerequisites

- Node.js `>=20.9`
- pnpm `>=9` (`corepack enable` will pin the version in `package.json`)
- Docker (only for the demo and the live-integration tests)

## Getting started

```bash
git clone https://github.com/artinrexhepii/smokejumper && cd smokejumper
pnpm install
pnpm test          # full offline test suite — no network, no API keys
pnpm typecheck
```

The default test suite is 100% offline: it runs against a deterministic fake
model and stubs every external service, so it needs no `ANTHROPIC_API_KEY` and
no containers.

To see the whole system run end to end, start the demo stack (a broken shop app,
a chaos injector, and the watchdog that files alerts):

```bash
pnpm demo:up
```

## Repository layout

This is a pnpm monorepo (ESM, TypeScript `strict`). The core is deliberately
ignorant of any specific vendor — alert sources, telemetry sources, and
notification sinks are all adapters against the plugin SDK.

| Path | What |
|---|---|
| `packages/plugin-sdk` | The stable adapter contract (manifests, tool specs, conformance checks) |
| `packages/plugin-host` | Loads adapters, validates instance config, resolves credentials |
| `packages/db` | Postgres schema, migrations, repositories, envelope encryption |
| `packages/engine` | The investigation engine (triage → plan → specialists → synthesis) |
| `packages/server` | Fastify API, ingestion, sessions, SSE |
| `apps/dashboard` | Next.js dashboard (a pure HTTP client of the server) |
| `plugins/*` | First-party adapters (webhook, sentry, docker, prometheus, loki, cloudwatch, kubernetes, …) |
| `deploy/helm/smokejumper` | Production Helm chart |
| `demo/` | The chaos harness and offline acceptance e2e |

## Writing a plugin

A plugin is a small package under `plugins/<id>` that exports a factory
returning a `TelemetrySource`, `AlertSource`, or `NotificationSink` from
`@smokejumper/plugin-sdk`. Every tool an adapter exposes is `scope: 'read'` —
the agent can look at anything and change nothing. Run
`checkTelemetrySource` / `checkAlertSource` from the SDK in your tests; the
registry conformance test will reject a manifest whose config shape the
dashboard form renderer can't describe.

## Conventions

- **Tests first.** Every change ships with tests; `pnpm test` must stay green.
- **Type safety.** `pnpm typecheck` must pass with zero errors; avoid `as any`.
- **Commit messages.** Single-line, lowercase, imperative subject describing the
  change (e.g. `add loki label_values tool`). No `type:` prefixes, no emoji.
- **No secrets in the tree.** Credentials live in the encrypted credentials
  column at runtime, never in config or fixtures.

## Submitting a pull request

1. Fork and branch from `main`.
2. Make your change with tests; run `pnpm test` and `pnpm typecheck`.
3. Open a PR using the template. Describe the motivation and how you verified it.
4. CI (`check`, `docker-build`, `kind-e2e`) must be green before review.

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
