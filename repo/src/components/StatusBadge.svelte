<script>
  /** @type {string} */
  export let status;
  /** @type {'order'|'ticket'|'queue'|'risk'|'generic'} */
  export let domain = 'generic';

  const ORDER_COLORS = {
    draft:       'neutral',
    placed:      'blue',
    in_progress: 'yellow',
    ready:       'green',
    completed:   'green-dark',
    canceled:    'red',
  };

  const TICKET_COLORS = {
    open:        'blue',
    in_progress: 'yellow',
    resolved:    'green',
    closed:      'neutral',
  };

  const QUEUE_COLORS = {
    Queued:      'blue',
    Sent:        'green-dark',
    Failed:      'red',
    Draft:       'neutral',
  };

  const RISK_COLORS = {
    open:        'red',
    in_review:   'yellow',
    resolved:    'green',
    dismissed:   'neutral',
  };

  $: colorMap = domain === 'order'
    ? ORDER_COLORS
    : domain === 'ticket'
    ? TICKET_COLORS
    : domain === 'queue'
    ? QUEUE_COLORS
    : domain === 'risk'
    ? RISK_COLORS
    : {};

  $: color = colorMap[status] ?? 'neutral';
  $: label = status.replace(/_/g, ' ');
</script>

<span class="badge badge--{color}" aria-label="Status: {label}">{label}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;
    text-transform: capitalize;
    line-height: 1.5;
  }

  .badge--neutral    { background: #f1f5f9; color: #475569; }
  .badge--blue       { background: #dbeafe; color: #1d4ed8; }
  .badge--yellow     { background: #fef9c3; color: #a16207; }
  .badge--green      { background: #dcfce7; color: #16a34a; }
  .badge--green-dark { background: #bbf7d0; color: #15803d; }
  .badge--red        { background: #fee2e2; color: #b91c1c; }
</style>
