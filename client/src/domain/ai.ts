import type { Activity, RoutingOptions } from './types';
import { CYCLING_PROFILES, normalizeRoutingOptions } from './routingOptions';

export interface AiContext {
  activity: Activity;
  routingOptions: Required<RoutingOptions>;
}
export interface AiProposal {
  routingOptions: RoutingOptions;
  explanation: string;
}
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function validAiProposal(value: unknown, activity: Activity): value is AiProposal {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !['routingOptions', 'explanation'].includes(key))
  )
    return false;
  const options = value.routingOptions;
  return (
    object(options) &&
    Object.keys(options).every((key) => {
      if (key === 'cyclingProfile')
        return (
          activity === 'cycling' && CYCLING_PROFILES.some((profile) => profile === options[key])
        );
      return ['avoidFerries', 'avoidSteps'].includes(key) && typeof options[key] === 'boolean';
    }) &&
    typeof value.explanation === 'string' &&
    value.explanation.trim().length > 0 &&
    value.explanation.length <= 2000
  );
}
export function aiChanges(context: AiContext, proposal: AiProposal) {
  if (!validAiProposal(proposal, context.activity)) throw new Error('Invalid AI proposal.');
  const next = normalizeRoutingOptions({ ...context.routingOptions, ...proposal.routingOptions });
  return (Object.keys(next) as (keyof Required<RoutingOptions>)[])
    .filter((key) => next[key] !== context.routingOptions[key])
    .map((key) => ({ key, before: context.routingOptions[key], after: next[key] }));
}
