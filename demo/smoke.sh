#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.yml -f demo/docker-compose.yml"
API=http://localhost:3400
JAR=$(mktemp)

if [ ! -f .env ]; then
  cp .env.example .env
  echo "SMOKEJUMPER_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
  echo "created .env with a generated encryption key"
fi

cleanup() {
  rm -f "$JAR"
  $COMPOSE down
}
trap cleanup EXIT

$COMPOSE up -d --build

echo "waiting for server health..."
for _ in $(seq 1 60); do
  curl -fsS "$API/healthz" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "$API/healthz" >/dev/null

echo "waiting for seed (login becomes possible)..."
for _ in $(seq 1 60); do
  if curl -fsS -c "$JAR" -X POST "$API/api/auth/login" \
    -H 'content-type: application/json' \
    -d '{"email":"admin@example.com","password":"smokejumper"}' >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

ORG_ID=$(curl -fsS -b "$JAR" "$API/api/me" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).orgs[0].id))')
PROJECT_ID=$(curl -fsS -b "$JAR" "$API/api/orgs/$ORG_ID/projects" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  const p=JSON.parse(d).find(p=>p.slug==="demo");
  if(!p){console.error("demo project not seeded");process.exit(1)}
  console.log(p.id)})')
echo "demo project: $PROJECT_ID"

echo "injecting error-storm..."
curl -fsS -X POST http://localhost:3401/chaos/error-storm >/dev/null

echo "waiting up to 180s for a diagnosed incident..."
deadline=$((SECONDS + 180))
while [ "$SECONDS" -lt "$deadline" ]; do
  STATUS=$(curl -fsS -b "$JAR" "$API/api/projects/$PROJECT_ID/incidents" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  const i=JSON.parse(d)[0];console.log(i?i.status:"none")})')
  echo "  incident status: $STATUS"
  if [ "$STATUS" = "diagnosed" ]; then
    echo "PASS: alert ingested, incident opened, investigation completed, diagnosis stored"
    exit 0
  fi
  sleep 5
done

echo "FAIL: no diagnosed incident within 180s"
exit 1
