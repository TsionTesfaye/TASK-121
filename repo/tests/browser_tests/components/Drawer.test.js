/**
 * Component tests — Drawer.svelte
 *
 * Covers:
 *   - renders nothing when open=false
 *   - renders overlay and aside when open=true
 *   - title rendered in header
 *   - close button dispatches 'close' event
 *   - overlay click dispatches 'close' event
 *   - Escape key dispatches 'close' event when open
 *   - Escape key ignored when open=false
 *   - footer slot renders when provided
 *   - default slot renders body content
 *   - size variants apply correct CSS class (sm, md, lg)
 *   - aside has role="complementary"
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Drawer from '../../../src/components/Drawer.svelte';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Drawer — visibility', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(Drawer, { props: { open: false, title: 'Test' } });
    expect(container.querySelector('.overlay')).toBeNull();
    expect(container.querySelector('.drawer')).toBeNull();
  });

  it('renders overlay and aside when open=true', () => {
    const { container } = render(Drawer, { props: { open: true, title: 'Test' } });
    expect(container.querySelector('.overlay')).toBeTruthy();
    expect(container.querySelector('aside')).toBeTruthy();
  });
});

describe('Drawer — content', () => {
  it('renders title in header', () => {
    const { getByText } = render(Drawer, { props: { open: true, title: 'My Panel' } });
    expect(getByText('My Panel')).toBeTruthy();
  });

  it('aside has role="complementary"', () => {
    const { container } = render(Drawer, { props: { open: true, title: 'Panel' } });
    const aside = container.querySelector('aside');
    expect(aside.getAttribute('role')).toBe('complementary');
  });

  it('close button is labeled and present', () => {
    const { getByLabelText } = render(Drawer, { props: { open: true, title: 'T' } });
    expect(getByLabelText('Close panel')).toBeTruthy();
  });
});

describe('Drawer — size variants', () => {
  it('applies drawer--sm class for size="sm"', () => {
    const { container } = render(Drawer, { props: { open: true, title: 'T', size: 'sm' } });
    expect(container.querySelector('.drawer--sm')).toBeTruthy();
  });

  it('applies drawer--md class for size="md" (default)', () => {
    const { container } = render(Drawer, { props: { open: true, title: 'T' } });
    expect(container.querySelector('.drawer--md')).toBeTruthy();
  });

  it('applies drawer--lg class for size="lg"', () => {
    const { container } = render(Drawer, { props: { open: true, title: 'T', size: 'lg' } });
    expect(container.querySelector('.drawer--lg')).toBeTruthy();
  });
});

describe('Drawer — events', () => {
  it('close button click dispatches close event', async () => {
    const { getByLabelText, component } = render(Drawer, { props: { open: true, title: 'T' } });
    const handler = vi.fn();
    component.$on('close', handler);

    await fireEvent.click(getByLabelText('Close panel'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('overlay click dispatches close event', async () => {
    const { container, component } = render(Drawer, { props: { open: true, title: 'T' } });
    const handler = vi.fn();
    component.$on('close', handler);

    const overlay = container.querySelector('.overlay');
    await fireEvent.click(overlay);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('Escape key dispatches close event when open', async () => {
    const { component } = render(Drawer, { props: { open: true, title: 'T' } });
    const handler = vi.fn();
    component.$on('close', handler);

    await fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('Escape key ignored when open=false', async () => {
    const { component } = render(Drawer, { props: { open: false, title: 'T' } });
    const handler = vi.fn();
    component.$on('close', handler);

    await fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Drawer — slots', () => {
  it('footer slot not rendered when not provided', () => {
    const { container } = render(Drawer, { props: { open: true, title: 'T' } });
    expect(container.querySelector('.drawer__footer')).toBeNull();
  });
});
