import { routeHandler } from '../server/routing.mjs';

export default async function handler(req, res) {
  return routeHandler(req, res);
}
