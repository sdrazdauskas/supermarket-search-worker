import type { LidlProduct } from '../types';
import { getCached, putCached, jsonResponse } from '../cache';
import { parseLidlProductsFromHtml } from '../parsers/lidl';

export async function handleLidlRoute(
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
	const maxPages = Math.max(1, Math.min(parseInt(String(body.maxPages)) || 3, 10));
	const forceRefresh = !!body.forceRefresh || forceRefreshQS;
	const cacheKey = `lidl:${query.toLowerCase()}:${maxPages}`;

	if (!forceRefresh) {
		const cached = await getCached<{ products: LidlProduct[] }>(env, cacheKey);
		if (cached) return jsonResponse(cached, { 'X-Cache': 'HIT' });
	}

	// NOTE: this UA must be a complete, realistic browser string — a truncated
	// UA looks like a fake/bot UA and gets served a stripped page with no
	// product grid. Headers below mirror a known-working manual request.
	const headers: Record<string, string> = {
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: 'https://www.lidl.lt/',
	};

	let allProducts: LidlProduct[] = [];
	for (let page = 1; page <= maxPages; page++) {
		const url = `https://www.lidl.lt/q/search?q=${encodeURIComponent(query)}&page=${page}`;
		const resp = await fetch(url, { headers });
		const html = await resp.text();
		const parsed = parseLidlProductsFromHtml(html);
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
