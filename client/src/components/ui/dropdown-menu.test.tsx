import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from './dropdown-menu';

function Example() {
  const [value, setValue] = useState('paved');
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><button>Surface choice</button></DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuRadioGroup value={value} onValueChange={setValue}>
        <DropdownMenuRadioItem value="paved">Paved</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="mixed">Mixed</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

it('uses a checkmark rather than a dot and preserves single selection', async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole('button', { name: 'Surface choice' }));
  let selected = screen.getByRole('menuitemradio', { name: 'Paved' });
  expect(selected).toHaveAttribute('aria-checked', 'true');
  expect(selected.querySelector('svg.lucide-check')).not.toBeNull();
  expect(selected.querySelector('svg.lucide-circle')).toBeNull();
  expect(screen.getByRole('menuitemradio', { name: 'Mixed' }).querySelector('svg')).toBeNull();
  await user.click(screen.getByRole('menuitemradio', { name: 'Mixed' }));
  await user.click(screen.getByRole('button', { name: 'Surface choice' }));
  selected = screen.getByRole('menuitemradio', { name: 'Mixed' });
  expect(selected).toHaveAttribute('aria-checked', 'true');
  expect(selected.querySelector('svg.lucide-check')).not.toBeNull();
  expect(screen.getByRole('menuitemradio', { name: 'Paved' }).querySelector('svg')).toBeNull();
});
