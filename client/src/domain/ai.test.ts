import { expect, it } from 'vitest';
import { aiChanges, validAiProposal } from './ai';
import { DEFAULT_ROUTING_OPTIONS } from './routingOptions';
it('accepts supported partial changes and finds only actual differences', () => {
  const proposal = {
    routingOptions: { avoidSteps: true, avoidFerries: false },
    explanation: 'Avoid steps.',
  };
  expect(validAiProposal(proposal, 'cycling')).toBe(true);
  expect(
    aiChanges({ activity: 'cycling', routingOptions: DEFAULT_ROUTING_OPTIONS }, proposal),
  ).toEqual([{ key: 'avoidSteps', before: false, after: true }]);
});
it('rejects invented options, profiles, invalid types and extra properties', () => {
  for (const routingOptions of [
    { avoidSteps: 'yes' },
    { surface: 'asphalt' },
    { cyclingProfile: 'fast' },
    [],
  ]) {
    expect(validAiProposal({ routingOptions, explanation: 'Proposal' }, 'cycling')).toBe(false);
  }
  expect(
    validAiProposal({ routingOptions: {}, explanation: ' ', coordinates: [] }, 'cycling'),
  ).toBe(false);
  expect(validAiProposal({ routingOptions: {}, explanation: 'x'.repeat(2001) }, 'cycling')).toBe(
    false,
  );
  expect(
    validAiProposal(
      { routingOptions: { cyclingProfile: 'cycling-road' }, explanation: 'Road' },
      'hiking',
    ),
  ).toBe(false);
});
it('allows unsupported wishes to return no changes', () => {
  expect(
    aiChanges(
      { activity: 'hiking', routingOptions: DEFAULT_ROUTING_OPTIONS },
      { routingOptions: {}, explanation: 'Cannot find cafes.' },
    ),
  ).toEqual([]);
});
