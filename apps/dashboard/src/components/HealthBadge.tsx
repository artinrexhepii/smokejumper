export type HealthState = 'checking' | { ok: boolean; message?: string }

export function HealthBadge({ state }: { state: HealthState }) {
  if (state === 'checking') {
    return (
      <span className="badge health-checking">
        <span className="dot pulse" aria-hidden />
        checking
      </span>
    )
  }
  return (
    <span className={`badge ${state.ok ? 'health-ok' : 'health-error'}`} title={state.message}>
      {state.ok ? 'healthy' : 'unhealthy'}
    </span>
  )
}
