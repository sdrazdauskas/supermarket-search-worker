// Requires a KV namespace bound as PRICE_CACHE in wrangler.jsonc:
//
//   "kv_namespaces": [
//     { "binding": "PRICE_CACHE", "id": "<run `wrangler kv namespace create PRICE_CACHE`>" }
//   ]
//
// All cache functions are defensive: if PRICE_CACHE isn't bound, they
// silently fall through to a live fetch instead of throwing.

export const CACHE_TTL_SECONDS = 60 * 60 * 12; // 12h default — tune to how often prices actually change

export async function hashKey(str: string): Promise<string> {
	const data = new TextEncoder().encode(str);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getCached<T>(env: Env, key: string): Promise<T | null> {
	if (!env.PRICE_CACHE) return null;
	try {
		const result = await env.PRICE_CACHE.get(key, { type: 'json' });
		return (result as T) ?? null;
	} catch (e) {
		return null;
	}
}

export function putCached(env: Env, ctx: ExecutionContext, key: string, value: unknown, ttl: number = CACHE_TTL_SECONDS): void {
	if (!env.PRICE_CACHE) return;
	ctx.waitUntil(
		env.PRICE_CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl }).catch(() => {})
	);
}

export function jsonResponse(body: unknown, extraHeaders: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			...extraHeaders,
		},
	});
}
