export const alertmanagerWebhook = {
  version: '4',
  groupKey: '{}:{alertname="HighErrorRate"}',
  truncatedAlerts: 0,
  status: 'firing',
  receiver: 'smokejumper',
  groupLabels: { alertname: 'HighErrorRate' },
  commonLabels: { alertname: 'HighErrorRate', severity: 'critical', service: 'shop-api' },
  commonAnnotations: { summary: 'Error rate above threshold' },
  externalURL: 'http://alertmanager.internal:9093',
  alerts: [
    {
      status: 'firing',
      labels: { alertname: 'HighErrorRate', severity: 'critical', service: 'shop-api', instance: 'shop-api-1' },
      annotations: {
        summary: 'shop-api error rate above 5%',
        description: '5xx rate is 12% over the last 5 minutes',
      },
      startsAt: '2026-07-05T09:00:00.000Z',
      endsAt: '0001-01-01T00:00:00Z',
      generatorURL: 'http://prometheus.internal:9090/graph?g0.expr=rate%28http_requests_total%7Bcode%3D%225xx%22%7D%5B5m%5D%29',
      fingerprint: 'abc123def456',
    },
    {
      status: 'resolved',
      labels: { alertname: 'DiskSpaceLow', severity: 'warning', job: 'node-exporter' },
      annotations: { description: 'disk usage recovered' },
      startsAt: '2026-07-05T08:30:00.000Z',
      endsAt: '2026-07-05T08:45:00.000Z',
      generatorURL: 'http://prometheus.internal:9090/graph?g1.expr=disk_free_percent+%3C+10',
      fingerprint: 'def456abc123',
    },
  ],
}
