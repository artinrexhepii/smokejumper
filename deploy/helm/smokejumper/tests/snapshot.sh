#!/usr/bin/env bash
set -euo pipefail

CHART="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> helm lint (default, external-db, oidc)"
helm lint "$CHART" -f "$CHART/ci/default-values.yaml"
helm lint "$CHART" -f "$CHART/ci/external-db-values.yaml"
helm lint "$CHART" -f "$CHART/ci/oidc-values.yaml"

echo "==> default render invariants"
OUT="$(helm template sj "$CHART" -f "$CHART/ci/default-values.yaml")"
grep -q 'image: "smokejumper-server:ci"' <<<"$OUT"
grep -q 'image: "smokejumper-dashboard:ci"' <<<"$OUT"
grep -q 'pgvector/pgvector:pg17' <<<"$OUT"
grep -q 'kind: StatefulSet' <<<"$OUT"
grep -q 'dist/seed.js' <<<"$OUT"
grep -q 'resources: \["pods", "pods/log", "events"\]' <<<"$OUT"
grep -q 'resources: \["deployments"\]' <<<"$OUT"
grep -q 'verbs: \["get", "list", "watch"\]' <<<"$OUT"
if grep -Eq 'verbs:.*(create|update|patch|delete)' <<<"$OUT"; then
  echo "FAIL: chart grants a write verb"; exit 1
fi

echo "==> external-db render omits postgres and uses the external url"
EXT="$(helm template sj "$CHART" -f "$CHART/ci/external-db-values.yaml")"
if grep -q 'kind: StatefulSet' <<<"$EXT"; then echo "FAIL: postgres rendered with external DB"; exit 1; fi
grep -q 'postgres://user:pass@db.example.com:5432/smokejumper' <<<"$EXT"

echo "==> oidc render wires issuer and client secret"
OIDC="$(helm template sj "$CHART" -f "$CHART/ci/oidc-values.yaml")"
grep -q 'OIDC_ISSUER' <<<"$OIDC"
grep -q 'name: OIDC_CLIENT_SECRET' <<<"$OIDC"

echo "PASS: chart snapshot invariants hold"
