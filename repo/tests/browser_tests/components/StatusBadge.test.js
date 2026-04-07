/**
 * Component tests — StatusBadge.svelte
 *
 * Covers:
 *   - renders with correct label text
 *   - label uses human-readable format (underscores → spaces)
 *   - correct color class for each domain
 *   - aria-label present
 *   - unknown status falls back to 'neutral'
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import StatusBadge from '../../../src/components/StatusBadge.svelte';

describe('StatusBadge', () => {
  it('renders the status label', () => {
    const { getByText } = render(StatusBadge, { props: { status: 'open', domain: 'risk' } });
    expect(getByText('open')).toBeTruthy();
  });

  it('replaces underscores with spaces in label', () => {
    const { getByText } = render(StatusBadge, { props: { status: 'in_progress', domain: 'order' } });
    expect(getByText('in progress')).toBeTruthy();
  });

  it('has aria-label with status', () => {
    const { getByLabelText } = render(StatusBadge, { props: { status: 'placed', domain: 'order' } });
    expect(getByLabelText('Status: placed')).toBeTruthy();
  });

  it('order domain: placed gets blue class', () => {
    const { getByLabelText } = render(StatusBadge, { props: { status: 'placed', domain: 'order' } });
    expect(getByLabelText('Status: placed').classList.contains('badge--blue')).toBe(true);
  });

  it('order domain: completed gets green-dark class', () => {
    const { getByLabelText } = render(StatusBadge, { props: { status: 'completed', domain: 'order' } });
    expect(getByLabelText('Status: completed').classList.contains('badge--green-dark')).toBe(true);
  });

  it('order domain: canceled gets red class', () => {
    const { getByLabelText } = render(StatusBadge, { props: { status: 'canceled', domain: 'order' } });
    expect(getByLabelText('Status: canceled').classList.contains('badge--red')).toBe(true);
  });

  it('ticket domain: resolved gets green class', () => {
    const { getByLabelText } = render(StatusBadge, { props: { status: 'resolved', domain: 'ticket' } });
    expect(getByLabelText('Status: resolved').classList.contains('badge--green')).toBe(true);
  });

  it('queue domain: Sent gets green-dark class', () => {
    const { getByLabelText } = render(StatusBadge, { props: { status: 'Sent', domain: 'queue' } });
    expect(getByLabelText('Status: Sent').classList.contains('badge--green-dark')).toBe(true);
  });

  it('unknown status falls back to neutral class', () => {
    const { getByLabelText } = render(StatusBadge, { props: { status: 'unknown_state', domain: 'generic' } });
    expect(getByLabelText('Status: unknown state').classList.contains('badge--neutral')).toBe(true);
  });
});
