import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Table, TableBody, TableCell, TableRow } from './table'

describe('responsive Table', () => {
  test('publishes translated mobile labels and marks an action column', () => {
    render(
      <Table mobileLabels={['Name', 'Status', '']}>
        <TableBody>
          <TableRow>
            <TableCell>Article</TableCell>
            <TableCell>Live</TableCell>
            <TableCell>Delete</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    const table = screen.getByRole('table')
    expect(table).toHaveAttribute('data-responsive-table', 'true')
    expect(table).toHaveAttribute('data-mobile-actions', 'true')
    expect(table.style.getPropertyValue('--ck-table-label-1')).toBe('"Name"')
    expect(table.style.getPropertyValue('--ck-table-label-2')).toBe('"Status"')
    expect(table.style.getPropertyValue('--ck-table-label-3')).toBe('""')
    expect(table.parentElement).toHaveAttribute('data-data-surface', 'true')
    expect(table.parentElement).not.toHaveClass('overflow-x-clip')
    expect(table.parentElement).not.toHaveClass('overflow-x-auto')
  })

  test('does not mark an ordinary final data column as actions', () => {
    render(
      <Table mobileLabels={['Name', 'Status']}>
        <TableBody>
          <TableRow>
            <TableCell>Article</TableCell>
            <TableCell>Live</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    expect(screen.getByRole('table')).not.toHaveAttribute('data-mobile-actions')
  })
})
