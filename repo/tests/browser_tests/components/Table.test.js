/**
 * Component tests — Table.svelte
 *
 * Covers:
 *   - renders column headers
 *   - renders row data
 *   - shows empty state when no rows
 *   - shows loading spinner when loading=true
 *   - empty state hidden when loading
 *   - custom empty message rendered
 *   - sortable column header has sort button
 *   - non-sortable column has no button
 *   - clicking sort toggles sort direction
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Table from '../../../src/components/Table.svelte';

const COLUMNS = [
  { key: 'name',   label: 'Name',   sortable: true },
  { key: 'status', label: 'Status', sortable: false },
];

const ROWS = [
  { id: '1', name: 'Alice', status: 'active' },
  { id: '2', name: 'Bob',   status: 'inactive' },
  { id: '3', name: 'Carol', status: 'active' },
];

describe('Table', () => {
  it('renders column headers', () => {
    const { getByText } = render(Table, { props: { columns: COLUMNS, rows: ROWS } });
    expect(getByText('Name')).toBeTruthy();
    expect(getByText('Status')).toBeTruthy();
  });

  it('renders row data for each column', () => {
    const { getByText } = render(Table, { props: { columns: COLUMNS, rows: ROWS } });
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('Bob')).toBeTruthy();
    expect(getByText('Carol')).toBeTruthy();
  });

  it('shows default empty state when rows is empty', () => {
    const { getByText } = render(Table, { props: { columns: COLUMNS, rows: [] } });
    expect(getByText('No records found.')).toBeTruthy();
  });

  it('shows custom empty message', () => {
    const { getByText } = render(Table, { props: { columns: COLUMNS, rows: [], empty: 'Nothing here yet.' } });
    expect(getByText('Nothing here yet.')).toBeTruthy();
  });

  it('hides rows and shows spinner when loading=true', () => {
    const { queryByText, getByLabelText } = render(Table, {
      props: { columns: COLUMNS, rows: ROWS, loading: true },
    });
    expect(getByLabelText('Loading')).toBeTruthy();
    expect(queryByText('Alice')).toBeNull();
  });

  it('does not show empty state when loading', () => {
    const { queryByText } = render(Table, {
      props: { columns: COLUMNS, rows: [], loading: true },
    });
    expect(queryByText('No records found.')).toBeNull();
  });

  it('sortable column has a button', () => {
    const { getAllByRole } = render(Table, { props: { columns: COLUMNS, rows: ROWS } });
    const buttons = getAllByRole('button');
    // Only 'Name' column is sortable.
    expect(buttons.some((b) => b.textContent.includes('Name'))).toBe(true);
  });

  it('non-sortable column does not have a button in its header', () => {
    const { queryByRole, getAllByRole } = render(Table, { props: { columns: COLUMNS, rows: ROWS } });
    const buttons = getAllByRole('button');
    // 'Status' should not be a button.
    expect(buttons.some((b) => b.textContent.trim() === 'Status')).toBe(false);
  });

  it('clicking sort button on Name column changes aria-sort', async () => {
    const { getByText, getAllByRole } = render(Table, { props: { columns: COLUMNS, rows: ROWS } });
    const sortButton = getAllByRole('button').find((b) => b.textContent.includes('Name'));
    await fireEvent.click(sortButton);
    // After one click, should sort ascending.
    const nameHeader = getByText('Name', { exact: false }).closest('th');
    expect(nameHeader.getAttribute('aria-sort')).toBe('ascending');
  });

  it('clicking sort button twice reverses direction', async () => {
    const { getByText, getAllByRole } = render(Table, { props: { columns: COLUMNS, rows: ROWS } });
    const sortButton = getAllByRole('button').find((b) => b.textContent.includes('Name'));
    await fireEvent.click(sortButton);
    await fireEvent.click(sortButton);
    const nameHeader = getByText('Name', { exact: false }).closest('th');
    expect(nameHeader.getAttribute('aria-sort')).toBe('descending');
  });
});
