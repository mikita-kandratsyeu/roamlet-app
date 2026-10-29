import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CoordinateInput, type CoordinateInputHandle } from './CoordinateInput';

afterEach(cleanup);

function setup(replacing = false) {
  const onAdd = vi.fn();
  const ref = createRef<CoordinateInputHandle>();
  render(<CoordinateInput ref={ref} replacing={replacing} onAdd={onAdd} />);
  return {
    onAdd, ref, user: userEvent.setup(),
    latitude: screen.getByRole('textbox', { name: 'Latitude' }),
    longitude: screen.getByRole('textbox', { name: 'Longitude' }),
  };
}

it('labels both fields and supports signed decimal commas and Enter from either field', async () => {
  const { latitude, longitude, user, onAdd } = setup();
  expect(screen.getByRole('button', { name: 'Add coordinates' })).toBeDisabled();
  await user.type(latitude, '-33,8');
  await user.type(longitude, '151,2{Enter}');
  expect(onAdd).toHaveBeenCalledWith([151.2, -33.8]);
  expect(latitude).toHaveFocus();
  expect(latitude).not.toHaveAttribute('aria-invalid', 'true');
});

it.each(['Latitude', 'Longitude'])('distributes pasted coordinate pairs from %s without adding a stop', async (name) => {
  const { latitude, longitude, user, onAdd } = setup();
  await user.click(screen.getByRole('textbox', { name }));
  await user.paste('47.26, 11.4');
  expect(latitude).toHaveValue('47.26');
  expect(longitude).toHaveValue('11.4');
  expect(onAdd).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect(onAdd).toHaveBeenCalledWith([11.4, 47.26]);
});

it('keeps a pasted single decimal-comma value in one field', async () => {
  const { latitude, longitude, user } = setup();
  await user.click(latitude);
  await user.paste('47,26');
  expect(latitude).toHaveValue('47,26');
  expect(longitude).toHaveValue('');
});

it('associates inline errors, focuses the invalid field and keeps values for correction', async () => {
  const { latitude, longitude, user, onAdd } = setup();
  await user.type(latitude, '91');
  await user.click(screen.getByRole('button', { name: 'Add coordinates' }));
  expect(latitude).toHaveFocus();
  expect(latitude).toHaveAttribute('aria-invalid', 'true');
  expect(latitude).toHaveAccessibleDescription(/Latitude must be between/);
  expect(longitude).toHaveAccessibleDescription(/Enter longitude/);
  expect(onAdd).not.toHaveBeenCalled();
  expect(latitude).toHaveValue('91');
  await user.clear(latitude);
  await user.type(latitude, '90');
  expect(latitude).toHaveAttribute('aria-invalid', 'false');
  await user.type(longitude, '181');
  await user.click(screen.getByRole('button', { name: 'Add coordinates' }));
  expect(longitude).toHaveFocus();
  expect(longitude).toHaveAccessibleDescription(/Longitude must be between/);
  await user.clear(longitude);
  await user.type(longitude, '180{Enter}');
  expect(onAdd).toHaveBeenCalledWith([180, 90]);
});

it('exposes reset/focus for App route lifecycle and clears errors after successful addition', async () => {
  const { latitude, longitude, user, ref, onAdd } = setup();
  onAdd.mockImplementation(() => ref.current?.clear());
  await user.type(latitude, 'Minsk');
  await user.click(screen.getByRole('button', { name: 'Add coordinates' }));
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  await user.clear(latitude);
  await user.type(latitude, '47.26');
  await user.type(longitude, '11.4{Enter}');
  expect(latitude).toHaveValue('');
  expect(longitude).toHaveValue('');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(latitude).toHaveFocus();
});

it('shows a replacement action instead of adding another stop', async () => {
  const { latitude, longitude, user, onAdd } = setup(true);
  expect(screen.getByRole('form', { name: 'Replace stop coordinates' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Replace stop coordinates' })).toHaveTextContent('Replace');
  fireEvent.change(latitude, { target: { value: '47.26 11.4' } });
  expect(longitude).toHaveValue('11.4');
  await user.click(screen.getByRole('button', { name: 'Replace stop coordinates' }));
  expect(onAdd).toHaveBeenCalledWith([11.4, 47.26]);
});

it('inherits offline automatic-routing fieldset disabling', () => {
  render(<fieldset disabled><CoordinateInput replacing={false} onAdd={vi.fn()} /></fieldset>);
  expect(screen.getByRole('textbox', { name: 'Latitude' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Longitude' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add coordinates' })).toBeDisabled();
});
