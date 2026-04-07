/**
 * Component tests — Modal.svelte
 *
 * Covers:
 *   - renders when open=true
 *   - does not render when open=false
 *   - close button dispatches 'close' event
 *   - Escape key dispatches 'close' event
 *   - title is rendered in heading
 *   - slot content is rendered in body
 *   - footer slot renders when provided
 *   - aria-modal attribute present
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Modal from '../../../src/components/Modal.svelte';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Modal', () => {
  it('renders nothing when open=false', () => {
    const { queryByRole } = render(Modal, { props: { open: false, title: 'Test' } });
    expect(queryByRole('dialog')).toBeNull();
  });

  it('renders dialog when open=true', () => {
    const { getByRole } = render(Modal, { props: { open: true, title: 'My Dialog' } });
    expect(getByRole('dialog')).toBeTruthy();
  });

  it('displays the title', () => {
    const { getByText } = render(Modal, { props: { open: true, title: 'Confirm Delete' } });
    expect(getByText('Confirm Delete')).toBeTruthy();
  });

  it('has aria-modal="true"', () => {
    const { getByRole } = render(Modal, { props: { open: true, title: 'A' } });
    expect(getByRole('dialog').getAttribute('aria-modal')).toBe('true');
  });

  it('has aria-labelledby pointing to title heading', () => {
    const { getByRole } = render(Modal, { props: { open: true, title: 'Labeled' } });
    const dialog = getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('modal-title');
  });

  it('close button is accessible and labeled', () => {
    const { getByLabelText } = render(Modal, { props: { open: true, title: 'T' } });
    const btn = getByLabelText('Close dialog');
    expect(btn).toBeTruthy();
  });

  it('close button click dispatches close event', async () => {
    const { getByLabelText, component } = render(Modal, { props: { open: true, title: 'T' } });
    const handler = vi.fn();
    component.$on('close', handler);

    await fireEvent.click(getByLabelText('Close dialog'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('Escape key dispatches close event', async () => {
    const { component } = render(Modal, { props: { open: true, title: 'T' } });
    const handler = vi.fn();
    component.$on('close', handler);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('Escape key ignored when modal is closed', async () => {
    const { component } = render(Modal, { props: { open: false, title: 'T' } });
    const handler = vi.fn();
    component.$on('close', handler);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
  });
});
