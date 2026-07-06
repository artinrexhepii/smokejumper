# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Core investigation engine: alert normalization + dedup, incident tracking,
  the triage → plan → specialists → synthesis pipeline, and hash-chained
  evidence records.
- Plugin SDK and host: a stable adapter contract with read-only tool boundaries,
  envelope-encrypted credentials, and config/credential schema separation.
- First-party adapters: webhook and Sentry alert sources; Docker, HTTP, GitHub
  deploys, Prometheus, Loki, CloudWatch, and Kubernetes telemetry sources;
  Slack and Alertmanager.
- Next.js dashboard with live investigation traces, an incident feed, and a
  plugin-management UI.
- OIDC single sign-on alongside password login.
- Production Helm chart (`deploy/helm/smokejumper`) with read-only RBAC for the
  in-cluster Kubernetes adapter, and CI (`check`, `docker-build`, `kind-e2e`).
