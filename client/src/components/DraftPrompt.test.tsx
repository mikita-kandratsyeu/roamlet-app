import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DraftPrompt } from './DraftPrompt';
afterEach(cleanup);
it('uses the shared compact description and action-row modal structure', () => {
  render(<DraftPrompt onDelete={vi.fn()} onRestore={vi.fn()} onDismiss={vi.fn()} />);
  const dialog = screen.getByRole('dialog', { name: 'Restore your draft?' });
  expect(dialog.querySelector('.dialog-header .dialog-description')).toHaveTextContent('An unfinished route was found on this device.');
  expect(dialog.querySelector('.dialog-body > p')).toBeNull();
  expect(dialog.querySelector('.button-row.dialog-actions')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore draft' })).toHaveFocus();
});
