import type { LidlProduct } from '../types';
import { getCached, putCached, jsonResponse } from '../cache';
import { parseLidlProductsFromHtml } from '../parsers/lidl';
import { getCurrentFlyers, mergeFlyerOffers } from '../lidlFlyers';

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

	// Search results and flyer offers are cached separately (flyers change more
	// often while a new week's flyer is being read) and merged per request.
	const [search, flyers] = await Promise.all([
		getSearchProducts(query, maxPages, forceRefresh, env, ctx),
		getCurrentFlyers(env, ctx, forceRefresh),
	]);

	const result = {
		products: flyers ? mergeFlyerOffers(search.products, flyers.offers, query) : search.products,
		// 'pending': a flyer is still being read, so flyer offers are incomplete;
		// 'unavailable': the flyer tracker couldn't be reached, results are search-only
		flyerStatus: !flyers ? 'unavailable' : flyers.pending ? 'pending' : 'done',
	};
	return jsonResponse(result, { 'X-Cache': search.cached ? 'HIT' : 'MISS' });
}

async function getSearchProducts(
	query: string,
	maxPages: number,
	forceRefresh: boolean,
	env: Env,
	ctx: ExecutionContext
): Promise<{ products: LidlProduct[]; cached: boolean }> {
	const cacheKey = `lidl:v2:${query.toLowerCase()}:${maxPages}`; // v2: products carry `ians`/`source`/`lidlPlus`

	if (!forceRefresh) {
		const cached = await getCached<{ products: LidlProduct[] }>(env, cacheKey);
		if (cached) return { products: cached.products, cached: true };
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

	putCached(env, ctx, cacheKey, { products: allProducts });
	return { products: allProducts, cached: false };
}
