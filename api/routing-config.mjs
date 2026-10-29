import { configHandler } from '../server/routing.mjs';

export default async function handler(req, res) {
  return configHandler(req, res);
}
