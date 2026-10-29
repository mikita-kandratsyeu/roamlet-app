import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import i18n from '../i18n';
import { RouteDescription } from './RouteDescription';

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

it.each(['', '  \n '])('does not add an empty description control for %j', (description) => {
  const { container } = render(<RouteDescription name="Forest walk" description={description} />);
  expect(container).toBeEmptyDOMElement();
});

it('opens the complete plain-text note and restores keyboard focus on dismissal', async () => {
  const user = userEvent.setup();
  const description = 'Meet at the station.\nBring water and comfortable shoes. <b>Not HTML</b>';
  render(<RouteDescription name="Forest walk" description={description} />);
  const trigger = screen.getByRole('button', { name: 'Read route description' });
  expect(trigger).toHaveAccessibleDescription(description);
  await user.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Route description' });
  expect(within(dialog).getByText('Forest walk')).toBeVisible();
  expect(dialog.querySelector('.route-description-full')?.textContent).toBe(description);
  expect(dialog.querySelector('b')).not.toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('does not carry an open description over to a different route', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<RouteDescription key="first" name="First route" description="First note" />);
  await user.click(screen.getByRole('button', { name: 'Read route description' }));
  rerender(<RouteDescription key="second" name="Second route" description="Second note" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('Second note')).toBeVisible();
});

it.each(['', 'A note for this route.'])('limits the preview to three tags and shows all tags in the full view (description: %j)', async (description) => {
  const user = userEvent.setup();
  const tags = ['Forest', 'Weekend', 'Scenic', 'Water', 'Quiet'];
  render(<RouteDescription name="Forest walk" description={description} tags={tags} />);
  const trigger = screen.getByRole('button', { name: 'View all route tags' });
  expect(trigger.querySelectorAll('[data-slot="badge"]')).toHaveLength(4);
  expect(trigger).toHaveTextContent('ForestWeekendScenic+2');
  await user.click(trigger);
  const dialog = screen.getByRole('dialog', { name: description ? 'Route description' : 'Route details' });
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(5);
  for (const tag of tags) expect(within(dialog).getByText(tag)).toBeVisible();
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
});

it('localizes the description control and dialog in Russian', async () => {
  const user = userEvent.setup();
  await i18n.changeLanguage('ru');
  render(<RouteDescription name="Лесная прогулка" description="Возьмите воду." />);
  await user.click(screen.getByRole('button', { name: 'Прочитать описание маршрута' }));
  expect(screen.getByRole('dialog', { name: 'Описание маршрута' })).toBeVisible();
});
