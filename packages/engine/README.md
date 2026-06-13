# @smokejumper/engine

Investigation engine: triage → plan → parallel specialists → synthesis. Consumes
telemetry tools from the plugin host, records every tool call as immutable evidence,
and produces diagnoses whose claims are verified against that evidence in code.

## Environment

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Read by Mastra's model router at generate time; not needed at construction or with the fake model |
| `SMOKEJUMPER_TRIAGE_MODEL` | `claude-haiku-4-5-20251001` | Triage phase model |
| `SMOKEJUMPER_INVESTIGATOR_MODEL` | `claude-sonnet-5` | Plan + specialist model |
| `SMOKEJUMPER_SYNTHESIS_MODEL` | `claude-sonnet-5` | Synthesis model |
| `SMOKEJUMPER_FAKE_MODEL` | unset | `1` → deterministic offline fake driver (demo/CI, no API key, no network) |

Budgets default to 25 tool calls / 4 minutes per investigation and are configurable
via `createInvestigator({ budgets })`.
