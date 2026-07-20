import type { IkiProduct } from '../types';
import { getCached, putCached, jsonResponse, hashKey } from '../cache';

export async function handleIkiRoute(
	target: string,
	request: Request,
	forceRefreshQS: boolean,
	env: Env,
	ctx: ExecutionContext
): Promise<Response | null> {
	let body: { multi?: { text: string; fromIndexes?: number[] }[]; params?: Record<string, unknown>; forceRefresh?: boolean } | null;
	try {
		body = await request.json();
	} catch (e) {
		body = null;
	}
	if (!body || !Array.isArray(body.multi)) {
		// Not the batched-multi shape this route handles — signal "not handled"
		// so the caller falls through to the generic proxy, same as before.
		return null;
	}

	const params = body.params || {};
	const forceRefresh = !!body.forceRefresh || forceRefreshQS;
	const cacheKey = 'ikilastmile:' + (await hashKey(target + '|' + JSON.stringify({ multi: body.multi, params })));

	if (!forceRefresh) {
		const cached = await getCached<{ products: IkiProduct[] }>(env, cacheKey);
		if (cached) return jsonResponse(cached, { 'X-Cache': 'HIT' });
	}

	let allProducts: IkiProduct[] = [];
	for (const q of body.multi) {
		const text = q.text;
		const fromIndexes = Array.isArray(q.fromIndexes) ? q.fromIndexes : [0];
		let stop = false;
		for (const fromIndex of fromIndexes) {
			if (stop) break;
			const resp = await fetch(target, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					personalized: false,
					query: { text, languageCode: 'lt' },
					params,
					fromIndex,
				}),
			});
			let data: { products?: IkiProduct[] } = {};
			try {
				data = await resp.json();
			} catch {
				data = {};
			}
			const products = Array.isArray(data.products) ? data.products : [];
			if (products.length === 0) {
				stop = true;
			} else {
				allProducts.push(...products);
			}
		}
	}
	const seen = new Set<string>();
	allProducts = allProducts.filter((p) => {
		const id = p.frontEndProduct?.id || p.id;
		if (!id || seen.has(id)) return false;
		seen.add(id);
		return true;
	});

	const result = { products: allProducts };
	putCached(env, ctx, cacheKey, result);
	return jsonResponse(result, { 'X-Cache': 'MISS' });
}
