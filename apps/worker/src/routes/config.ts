import { flagOn, flagOff } from '../lib/flags.js';
import type { Env } from '../index.js';

interface RouteCtx {
  request: Request;
  env: Env;
  parts: string[];
}

export async function dispatchConfig(ctx: RouteCtx): Promise<Response | null> {
  const { request, env, parts } = ctx;
  if (parts[0] !== 'config') return null;

  if (parts.length === 1 && request.method === 'GET') {
    const body = {
      flags: {
        // flagOn: opt-in flags; default off in tests, must be set "true" in prod
        autosyncOnLogin: flagOn(env, 'WWP_FEAT_AUTOSYNC_ON_LOGIN'),
        steamRatings: flagOn(env, 'WWP_FEAT_STEAM_RATINGS'),
        // flagOff: opt-out flags; default ON, only disabled if explicitly "false"
        thumbs: !flagOff(env, 'WWP_FEAT_THUMBS'),
        recommendations: !flagOff(env, 'WWP_FEAT_RECOMMENDATIONS'),
      },
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  return null;
}
