/**
 * Component tests — FormField.svelte
 *
 * Covers:
 *   - renders label text
 *   - required field shows asterisk indicator
 *   - error message shown when error prop set
 *   - hint shown when hint prop set and no error
 *   - error takes precedence over hint
 *   - error has role="alert"
 *   - field has error class when error present
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import FormField from '../../../src/components/FormField.svelte';

describe('FormField', () => {
  it('renders the label', () => {
    const { getByText } = render(FormField, { props: { label: 'Email address', id: 'email' } });
    expect(getByText('Email address')).toBeTruthy();
  });

  it('required=true shows asterisk', () => {
    const { container } = render(FormField, { props: { label: 'Name', id: 'name', required: true } });
    expect(container.querySelector('.required')).toBeTruthy();
  });

  it('required=false hides asterisk', () => {
    const { container } = render(FormField, { props: { label: 'Name', id: 'name', required: false } });
    expect(container.querySelector('.required')).toBeNull();
  });

  it('error message rendered when error prop set', () => {
    const { getByRole } = render(FormField, { props: { label: 'Name', id: 'name', error: 'This field is required.' } });
    const alert = getByRole('alert');
    expect(alert.textContent).toBe('This field is required.');
  });

  it('hint shown when no error', () => {
    const { getByText } = render(FormField, { props: { label: 'Pw', id: 'pw', hint: 'Min 12 characters.' } });
    expect(getByText('Min 12 characters.')).toBeTruthy();
  });

  it('error takes precedence over hint', () => {
    const { queryByText, getByRole } = render(FormField, {
      props: { label: 'Pw', id: 'pw', error: 'Too short.', hint: 'Min 12 characters.' },
    });
    expect(getByRole('alert').textContent).toBe('Too short.');
    expect(queryByText('Min 12 characters.')).toBeNull();
  });

  it('field has error CSS class when error is set', () => {
    const { container } = render(FormField, { props: { label: 'X', id: 'x', error: 'Bad' } });
    expect(container.querySelector('.field--error')).toBeTruthy();
  });

  it('field has no error CSS class when no error', () => {
    const { container } = render(FormField, { props: { label: 'X', id: 'x' } });
    expect(container.querySelector('.field--error')).toBeNull();
  });

  it('label for attribute matches id prop', () => {
    const { container } = render(FormField, { props: { label: 'City', id: 'city-input' } });
    const labelEl = container.querySelector('label');
    expect(labelEl.getAttribute('for')).toBe('city-input');
  });
});
