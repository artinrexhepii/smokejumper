import type { ReactNode } from 'react'

export function AuthLayout({ heroTitle, children }: { heroTitle: string; children: ReactNode }) {
  return (
    <div className="login-wrap">
      <aside className="login-aside">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-spark" />
          </span>
          <span className="brand-word">Smokejumper</span>
        </div>

        <div className="login-hero">
          <span className="login-hero-eyebrow">Incident command</span>
          <h1>{heroTitle}</h1>
          <p>
            Smokejumper watches your systems, dispatches AI investigators the moment an alert fires, and returns a
            diagnosis with every claim cited to real telemetry.
          </p>
        </div>

        <div className="login-foot">
          <span>
            <b>Read-only</b> by design
          </span>
          <span>
            <b>Evidence-cited</b> diagnoses
          </span>
          <span>
            <b>Self-hosted</b>
          </span>
        </div>
      </aside>

      <div className="login-main">{children}</div>
    </div>
  )
}
