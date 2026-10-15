import type { NorfaProduct } from '../types';
import { getCached, putCached, jsonResponse } from '../cache';
import { parseNorfaProductsFromHtml } from '../parsers/norfa';

// Norfa's "practical offers" flyer page isn't parametrized by a search query,
// so there's one shared cache entry for everyone; the client filters by
// product name after fetching.
export async function handleNorfaRoute(target: string, forceRefreshQS: boolean, env: Env, ctx: ExecutionContext): Promise<Response> {
	const cacheKey = 'norfa:praktiski-pasiulymai';

	if (!forceRefreshQS) {
		const cached = await getCached<{ products: NorfaProduct[] }>(env, cacheKey);
		if (cached) return jsonResponse(cached, { 'X-Cache': 'HIT' });
	}

	const headers: Record<string, string> = {
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'lt-LT,lt;q=0.9,en-US;q=0.8,en;q=0.7',
		Referer: 'https://www.norfa.lt/',
	};
	const resp = await fetch(target, { headers });
	const html = await resp.text();
	const products = parseNorfaProductsFromHtml(html);

	const result = { products };
	putCached(env, ctx, cacheKey, result);
	return jsonResponse(result, { 'X-Cache': 'MISS' });
}
