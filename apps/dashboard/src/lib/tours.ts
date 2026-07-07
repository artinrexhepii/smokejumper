// Guided-tour definitions. Each authenticated page has its own tour; steps target
// real elements by their `data-tour="…"` attribute (a step with no target renders as
// a centered card). The Tour engine skips any step whose target isn't on the page,
// so conditional UI (empty states, lists) degrades gracefully.

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  /** value of the `data-tour` attribute to highlight; omit for a centered intro/outro card */
  target?: string
  title: string
  body: string
  placement?: TourPlacement
}

export interface TourDef {
  id: string
  label: string
  steps: TourStep[]
}

const dispatch: TourDef = {
  id: 'dispatch',
  label: 'Dispatch board',
  steps: [
    {
      title: 'Welcome to Smokejumper',
      body: 'This 60-second walkthrough shows you around. Use Next and Back to move, or Skip anytime — you can replay any page’s tour from the button in the top bar.',
    },
    {
      target: 'nav-dispatch',
      title: 'Dispatch is home base',
      body: 'Every open incident lands here. You’ll come back to this board to see what’s on fire and how investigations are going.',
      placement: 'right',
    },
    {
      target: 'nav-configure',
      title: 'Set things up under Configure',
      body: 'Projects, your team, telemetry sources, the plugin marketplace, and runbooks all live here. If you’re just starting, this is where you’ll spend your first few minutes.',
      placement: 'right',
    },
    {
      target: 'board-hero',
      title: 'The board fills itself',
      body: 'You don’t create incidents by hand. When an alert source fires, an incident appears here on its own and an investigation kicks off automatically.',
      placement: 'bottom',
    },
    {
      target: 'board-stats',
      title: 'The state of things, at a glance',
      body: 'A running count of what’s active, still being investigated, and already resolved.',
      placement: 'bottom',
    },
    {
      target: 'incident-list',
      title: 'Each row is an incident',
      body: 'Severity, status, which service, and how recently it fired. Click any row to watch its investigation and read the diagnosis.',
      placement: 'top',
    },
    {
      target: 'topbar-tour',
      title: 'Stuck on any page?',
      body: 'Every page has its own tour. Hit “Tour this page” up here to run it again whenever you need a refresher.',
      placement: 'bottom',
    },
    {
      title: 'Next: give it something to watch',
      body: 'An empty board stays empty until Smokejumper can see your systems. Head to Configure → Sources to connect your first telemetry or alert source.',
    },
  ],
}

const incident: TourDef = {
  id: 'incident',
  label: 'Incident',
  steps: [
    {
      title: 'Reading an incident',
      body: 'This is where an investigation plays out. Here’s how to read what the AI investigators found — and how to have the final say.',
    },
    {
      target: 'incident-head',
      title: 'What happened, and how bad',
      body: 'Severity, current status, the affected service, how many alerts fired, and when it opened.',
      placement: 'bottom',
    },
    {
      target: 'trace-timeline',
      title: 'A live trace of the investigation',
      body: 'Each entry is a step an investigator actually took — a query run, a source read — streamed in as it happens.',
      placement: 'bottom',
    },
    {
      target: 'findings',
      title: 'What they concluded',
      body: 'The findings the investigators surfaced. Each one links back to the evidence it’s based on — nothing is asserted without a citation.',
      placement: 'top',
    },
    {
      target: 'diagnosis',
      title: 'The likely root cause',
      body: 'The synthesized diagnosis: the most probable cause, written up with citations to the evidence below.',
      placement: 'top',
    },
    {
      target: 'review-panel',
      title: 'You have the final word',
      body: 'Confirm or reject the diagnosis here. Your verdict is recorded and sharpens future investigations — a human always signs off.',
      placement: 'top',
    },
    {
      target: 'evidence-log',
      title: 'The receipts',
      body: 'Every raw piece of evidence the investigators pulled, kept in full so any claim can be traced back and audited.',
      placement: 'top',
    },
  ],
}

const projects: TourDef = {
  id: 'projects',
  label: 'Projects',
  steps: [
    {
      title: 'What a project is',
      body: 'A project groups one service’s incidents, telemetry connections, and runbooks. Most teams make one project per service or app.',
    },
    {
      target: 'projects-create',
      title: 'Create a project',
      body: 'Name it after a service — the URL slug is generated for you. You’ll pick this project when you connect sources or add runbooks.',
      placement: 'bottom',
    },
    {
      target: 'projects-list',
      title: 'Your projects live here',
      body: 'Everything you’ve created, with its slug. This is the list you’ll choose from elsewhere in the app.',
      placement: 'top',
    },
  ],
}

const team: TourDef = {
  id: 'team',
  label: 'Team',
  steps: [
    {
      title: 'Your organization',
      body: 'Manage who’s in your org and what they’re allowed to do. Owners and admins configure things; members can view incidents and confirm verdicts.',
    },
    {
      target: 'team-members',
      title: 'Members and roles',
      body: 'Change anyone’s role from the dropdown, or remove them. There’s always at least one owner — the app won’t let you lock yourself out.',
      placement: 'bottom',
    },
    {
      target: 'team-invite',
      title: 'Invite teammates',
      body: 'Generate an invite link and share it however you like — no email server required. Leave the email blank for an open link, or pin it to one address.',
      placement: 'top',
    },
    {
      target: 'team-org',
      title: 'Name your organization',
      body: 'Rename the org here anytime. The new name shows up across the app after a refresh.',
      placement: 'top',
    },
  ],
}

const sources: TourDef = {
  id: 'sources',
  label: 'Sources',
  steps: [
    {
      title: 'Sources are what it reads',
      body: 'A source is any system Smokejumper reads to investigate — telemetry like Datadog, Grafana or Kubernetes, or an alert source like PagerDuty or a webhook.',
    },
    {
      target: 'sources-scope',
      title: 'Sources are per project',
      body: 'Pick the organization and project first — the sources you connect here only power investigations for that project.',
      placement: 'bottom',
    },
    {
      target: 'sources-add',
      title: 'Connect a source',
      body: 'Choose a source type, then give it the endpoint and credentials it needs. Secrets are stored encrypted and scoped to this project.',
      placement: 'top',
    },
    {
      target: 'sources-list',
      title: 'Manage what’s connected',
      body: 'Each connected source shows a live health check. Toggle it on or off, edit its config, or remove it.',
      placement: 'top',
    },
  ],
}

const marketplace: TourDef = {
  id: 'marketplace',
  label: 'Marketplace',
  steps: [
    {
      title: 'The plugin catalog',
      body: 'The marketplace is every plugin your server can run — the source types, notification sinks, and action sinks available to your projects.',
    },
    {
      target: 'market-search',
      title: 'Find a plugin',
      body: 'Search by name or filter by kind: alert source, telemetry, context, notification, or action.',
      placement: 'bottom',
    },
    {
      target: 'market-policy',
      title: 'Install only what you trust',
      body: 'Installed plugins run in-process with the server’s privileges. Auto-update is off by default, and first-party plugins are signed and marked “built-in”.',
      placement: 'bottom',
    },
    {
      target: 'market-list',
      title: 'Browse and install',
      body: 'Open “details” to read a plugin, see its versions, and install one. Built-ins ship with Smokejumper and are ready to use.',
      placement: 'top',
    },
  ],
}

const runbooks: TourDef = {
  id: 'runbooks',
  label: 'Runbooks',
  steps: [
    {
      title: 'Give investigators your playbook',
      body: 'Runbooks are your team’s written knowledge — incident procedures, architecture notes, past post-mortems. Investigators search them during an incident.',
    },
    {
      target: 'runbooks-scope',
      title: 'Runbooks are per project',
      body: 'Pick the organization and project — runbooks added here are searched for that project’s incidents.',
      placement: 'bottom',
    },
    {
      target: 'runbooks-add',
      title: 'Add a runbook',
      body: 'Paste text or point at a URL. Smokejumper chunks and embeds it so investigators can pull the relevant passage as cited evidence.',
      placement: 'bottom',
    },
  ],
}

export const TOURS: Record<string, TourDef> = {
  dispatch,
  incident,
  projects,
  team,
  sources,
  marketplace,
  runbooks,
}

const ROUTE_TOURS: Array<[RegExp, string]> = [
  [/^\/incidents\//, 'incident'],
  [/^\/settings\/projects/, 'projects'],
  [/^\/settings\/team/, 'team'],
  [/^\/settings\/plugins/, 'sources'],
  [/^\/settings\/marketplace/, 'marketplace'],
  [/^\/settings\/runbooks/, 'runbooks'],
  [/^\/$/, 'dispatch'],
]

/** The tour that belongs to a pathname, or null if the page has none. */
export function getTourForPath(pathname: string): TourDef | null {
  for (const [re, id] of ROUTE_TOURS) {
    if (re.test(pathname)) return TOURS[id] ?? null
  }
  return null
}

export const TOUR_SEEN_PREFIX = 'sj_tour_'
