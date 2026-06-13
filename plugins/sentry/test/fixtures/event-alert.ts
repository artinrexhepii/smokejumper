export const sentryEventAlert = {
  action: 'triggered',
  actor: { id: 'sentry', name: 'Sentry', type: 'application' },
  data: {
    event: {
      event_id: 'e4874d664c3540c1a32eab185f12c5ab',
      issue_id: '1117540176',
      level: 'error',
      platform: 'javascript',
      project: 1,
      culprit: 'checkoutHandler(/checkout)',
      datetime: '2026-07-04T09:14:31.000000Z',
      title: 'TypeError: Cannot read properties of undefined (reading "id")',
      tags: [
        ['environment', 'production'],
        ['server_name', 'shop-api-7d9f'],
        ['level', 'error'],
        ['browser', 'Chrome 138.0.0'],
      ],
      url: 'https://sentry.io/api/0/projects/acme/shop-api/events/e4874d664c3540c1a32eab185f12c5ab/',
      web_url: 'https://sentry.io/organizations/acme/issues/1117540176/events/e4874d664c3540c1a32eab185f12c5ab/',
      issue_url: 'https://sentry.io/api/0/issues/1117540176/',
    },
    triggered_rule: 'High error volume',
  },
  installation: { uuid: 'a4f4e661-26ba-4dc4-a132-64181e4f0ef6' },
}
