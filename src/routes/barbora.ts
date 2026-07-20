import type { BarboraCacheEntry } from '../types';
import { getCached, putCached, hashKey } from '../cache';

export async function handleBarboraRoute(
	target: string,
	cookie: string | null,
	forceRefreshQS: boolean,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	const cacheKey = 'barbora:' + (await hashKey(target + '|' + (cookie || '')));

	if (!forceRefreshQS) {
		const cached = await getCached<BarboraCacheEntry>(env, cacheKey);
		if (cached) {
			return new Response(cached.body, {
				status: cached.status,
				headers: {
					'Content-Type': cached.contentType,
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
					'X-Cache': 'HIT',
				},
			});
		}
	}

	const headers: Record<string, string> = {
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
		Accept: 'application/json, text/plain, */*',
		'Accept-Language': 'lt-LT,lt;q=0.9,en-US;q=0.8,en;q=0.7',
		Referer: 'https://barbora.lt/',
		Origin: 'https://barbora.lt',
	};
	if (cookie) headers['Cookie'] = cookie;
	const resp = await fetch(target, { headers });
	const contentType = resp.headers.get('content-type') || '';
	const body = await resp.text();
	const normalizedContentType = contentType.includes('application/json') ? 'application/json' : contentType;

	putCached(env, ctx, cacheKey, { body, contentType: normalizedContentType, status: resp.status } satisfies BarboraCacheEntry);

	return new Response(body, {
		status: resp.status,
		headers: {
			'Content-Type': normalizedContentType,
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			'X-Cache': 'MISS',
		},
	});
}
