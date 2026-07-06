# Security Policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in Smokejumper, please
report it privately. **Do not open a public GitHub issue for security problems.**

Email **office@milveo.com** with:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if you have one),
- the affected version or commit.

You can expect an acknowledgement within a few business days. Once the issue is
confirmed and a fix is available, we will coordinate a disclosure timeline with
you and credit you in the release notes unless you prefer to stay anonymous.

## Scope

Smokejumper is self-hosted and **read-only** by design: the investigation agent
can query telemetry but cannot mutate any connected system, and the in-cluster
Kubernetes adapter ships with a Role granting only `get`/`list`/`watch`. Reports
that concern credential handling, the envelope encryption of plugin secrets,
authentication/session handling, the OIDC flow, or a way for the agent to escape
its read-only tool boundary are especially in scope.

## Supported versions

The project is pre-1.0; security fixes land on `main` and in the latest release.
