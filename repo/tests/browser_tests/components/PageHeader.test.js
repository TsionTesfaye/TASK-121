/**
 * Component tests — PageHeader.svelte
 *
 * Covers:
 *   - renders h1 with title prop
 *   - title prop is required and displayed as h1
 *   - description rendered as paragraph when provided
 *   - description NOT rendered when empty
 *   - header element wraps content
 *   - actions slot: container present when slot populated
 *   - actions slot: container absent when no slot content
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import PageHeader from '../../../src/components/PageHeader.svelte';

describe('PageHeader — title', () => {
  it('renders title in an h1 element', () => {
    const { container } = render(PageHeader, { props: { title: 'My Page' } });
    const h1 = container.querySelector('h1');
    expect(h1).toBeTruthy();
    expect(h1.textContent).toBe('My Page');
  });

  it('h1 has class page-header__title', () => {
    const { container } = render(PageHeader, { props: { title: 'Dashboard' } });
    expect(container.querySelector('.page-header__title')).toBeTruthy();
  });

  it('wraps content in a <header> element', () => {
    const { container } = render(PageHeader, { props: { title: 'T' } });
    expect(container.querySelector('header.page-header')).toBeTruthy();
  });
});

describe('PageHeader — description', () => {
  it('renders description paragraph when provided', () => {
    const { getByText } = render(PageHeader, {
      props: { title: 'T', description: 'Some helpful text' },
    });
    expect(getByText('Some helpful text')).toBeTruthy();
  });

  it('description has class page-header__desc', () => {
    const { container } = render(PageHeader, {
      props: { title: 'T', description: 'Desc' },
    });
    expect(container.querySelector('.page-header__desc')).toBeTruthy();
  });

  it('does NOT render description paragraph when description is empty', () => {
    const { container } = render(PageHeader, { props: { title: 'T' } });
    expect(container.querySelector('.page-header__desc')).toBeNull();
  });

  it('does NOT render description when explicitly empty string', () => {
    const { container } = render(PageHeader, { props: { title: 'T', description: '' } });
    expect(container.querySelector('.page-header__desc')).toBeNull();
  });
});

describe('PageHeader — actions slot', () => {
  it('actions container absent when no slot content provided', () => {
    const { container } = render(PageHeader, { props: { title: 'T' } });
    expect(container.querySelector('.page-header__actions')).toBeNull();
  });
});
