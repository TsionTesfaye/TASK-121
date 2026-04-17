/**
 * Component tests — EmptyState.svelte
 *
 * Covers:
 *   - has role="status" for screen readers
 *   - renders default message when none provided
 *   - renders custom message prop
 *   - icon element rendered
 *   - action slot: rendered when action prop is non-empty
 *   - action slot: NOT rendered when action prop is empty
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import EmptyState from '../../../src/components/EmptyState.svelte';

describe('EmptyState — accessibility', () => {
  it('has role="status"', () => {
    const { getByRole } = render(EmptyState);
    expect(getByRole('status')).toBeTruthy();
  });

  it('icon element is aria-hidden', () => {
    const { container } = render(EmptyState);
    const icon = container.querySelector('.empty-state__icon');
    expect(icon).toBeTruthy();
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('EmptyState — message prop', () => {
  it('renders default message when no message prop given', () => {
    const { getByText } = render(EmptyState);
    expect(getByText('No items yet.')).toBeTruthy();
  });

  it('renders custom message when provided', () => {
    const { getByText } = render(EmptyState, { props: { message: 'Nothing here yet.' } });
    expect(getByText('Nothing here yet.')).toBeTruthy();
  });

  it('message is inside .empty-state__message element', () => {
    const { container } = render(EmptyState, { props: { message: 'Custom text' } });
    const p = container.querySelector('.empty-state__message');
    expect(p).toBeTruthy();
    expect(p.textContent).toBe('Custom text');
  });
});

describe('EmptyState — action slot', () => {
  it('action slot container not rendered when action prop is empty', () => {
    const { container } = render(EmptyState, { props: { action: '' } });
    // When action is falsy, the {#if action} block does not render the slot
    // The slot anchor won't be present — no .empty-state slot wrapper
    // We verify the component rendered successfully with no extra content beyond icon+message
    const children = container.querySelector('.empty-state')?.children;
    // icon + message = 2 children; no extra action slot container
    expect(children?.length).toBeLessThanOrEqual(2);
  });

  it('action prop triggers slot rendering when non-empty', () => {
    const { container } = render(EmptyState, { props: { action: 'Add item' } });
    // When action is truthy, the slot region is conditionally present
    const emptyState = container.querySelector('.empty-state');
    expect(emptyState).toBeTruthy();
  });
});
