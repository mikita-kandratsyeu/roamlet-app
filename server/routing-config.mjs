export function routingApiKey(environment = process.env) {
  return typeof environment.ORS_API_KEY === 'string' ? environment.ORS_API_KEY.trim() : '';
}
