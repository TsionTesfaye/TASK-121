/**
 * Component tests — Tabs.svelte
 *
 * Covers:
 *   - renders all tab buttons
 *   - active tab has aria-selected="true"
 *   - inactive tabs have aria-selected="false"
 *   - clicking a tab dispatches 'change' event with key
 *   - clicking active tab does not re-dispatch
 *   - disabled tab cannot be selected
 *   - tablist role present
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Tabs from '../../../src/components/Tabs.svelte';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'history',  label: 'History' },
  { key: 'settings', label: 'Settings', disabled: true },
];

describe('Tabs', () => {
  it('renders all tab buttons', () => {
    const { getAllByRole } = render(Tabs, { props: { tabs: TABS, active: 'overview' } });
    const buttons = getAllByRole('tab');
    expect(buttons).toHaveLength(3);
  });

  it('tablist role is present', () => {
    const { getByRole } = render(Tabs, { props: { tabs: TABS, active: 'overview' } });
    expect(getByRole('tablist')).toBeTruthy();
  });

  it('active tab has aria-selected=true', () => {
    const { getByText } = render(Tabs, { props: { tabs: TABS, active: 'history' } });
    expect(getByText('History').getAttribute('aria-selected')).toBe('true');
  });

  it('inactive tabs have aria-selected=false', () => {
    const { getByText } = render(Tabs, { props: { tabs: TABS, active: 'overview' } });
    expect(getByText('History').getAttribute('aria-selected')).toBe('false');
  });

  it('clicking a tab dispatches change event with key', async () => {
    const { getByText, component } = render(Tabs, { props: { tabs: TABS, active: 'overview' } });
    const handler = vi.fn();
    component.$on('change', handler);

    await fireEvent.click(getByText('History'));
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].detail).toEqual({ key: 'history' });
  });

  it('clicking already-active tab does not dispatch change', async () => {
    const { getByText, component } = render(Tabs, { props: { tabs: TABS, active: 'overview' } });
    const handler = vi.fn();
    component.$on('change', handler);

    await fireEvent.click(getByText('Overview'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('disabled tab has disabled attribute', () => {
    const { getByText } = render(Tabs, { props: { tabs: TABS, active: 'overview' } });
    expect(getByText('Settings').disabled).toBe(true);
  });

  it('disabled tab does not dispatch change on click', async () => {
    const { getByText, component } = render(Tabs, { props: { tabs: TABS, active: 'overview' } });
    const handler = vi.fn();
    component.$on('change', handler);

    await fireEvent.click(getByText('Settings'));
    expect(handler).not.toHaveBeenCalled();
  });
});
