import type { RimiProduct } from '../types';
import { getCached, putCached, jsonResponse } from '../cache';
import { parseRimiProductsFromHtml } from '../parsers/rimi';

export async function handleRimiRoute(
	request: Request,
	forceRefreshQS: boolean,
	env: Env,
	ctx: ExecutionContext
): Promise<Response | null> {
	let body: { query?: string; maxPages?: number; forceRefresh?: boolean } | null;
	try {
		body = await request.json();
	} catch (e) {
		body = null;
	}
	if (!body || !body.query) {
		return null; // not handled — caller falls through to the generic proxy
	}

	const query = body.query;
	const maxPages = Math.max(1, Math.min(parseInt(String(body.maxPages)) || 20, 50));
	const forceRefresh = !!body.forceRefresh || forceRefreshQS;
	const cacheKey = `rimi:${query.toLowerCase()}:${maxPages}`;

	if (!forceRefresh) {
		const cached = await getCached<{ products: RimiProduct[] }>(env, cacheKey);
		if (cached) return jsonResponse(cached, { 'X-Cache': 'HIT' });
	}

	const urls: string[] = [];
	for (let page = 1; page <= maxPages; page++) {
		urls.push(
			`https://www.rimi.lt/e-parduotuve/lt/paieska?currentPage=${page}&pageSize=100&query=${encodeURIComponent(
				query + ':price-asc:assortmentStatus:inAssortment'
			)}`
		);
	}
	const headers: Record<string, string> = {
		'User-Agent': 'Mozilla/5.0',
		Accept: 'text/html,application/xhtml+xml,application/xml',
		'Accept-Language': 'lt-LT,lt;q=0.9,en-US;q=0.8,en;q=0.7',
		Referer: 'https://www.rimi.lt/',
	};

	const htmlPagesRaw = await Promise.all(urls.map((url) => fetch(url, { headers }).then((r) => r.text())));

	let allProducts: RimiProduct[] = [];
	for (const html of htmlPagesRaw) {
		const parsed = parseRimiProductsFromHtml(html);
		if (parsed.length === 0) break;
		allProducts.push(...parsed);
	}

	const seen = new Set<string>();
	allProducts = allProducts.filter((p) => {
		if (!p.id || seen.has(p.id)) return false;
		seen.add(p.id);
		return true;
	});

	const result = { products: allProducts };
	putCached(env, ctx, cacheKey, result);
	return jsonResponse(result, { 'X-Cache': 'MISS' });
}
