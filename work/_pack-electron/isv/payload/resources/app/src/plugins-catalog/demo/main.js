/* demo - the smallest possible Infinity Server plugin.
 * One manifest, one route: GET /v1/plugins/demo/ping.
 * The route path is registered without a leading slash; the dispatcher
 * compares it against the path segment after /v1/plugins/<id>/. */
export function register(ctx) {
  return {
    routes: [
      { method: 'GET', path: 'ping', handler: async () => ({ pong: true, at: new Date().toISOString() }) }
    ]
  };
}
