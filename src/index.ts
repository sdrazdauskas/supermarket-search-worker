/**
 * Grocery price proxy/scraper worker (Barbora, Lidl, Rimi, IKI/LastMile),
 * with KV-backed response caching.
 *
 * Bind a KV namespace in wrangler.jsonc:
 *
 *   "kv_namespaces": [
 *     { "binding": "PRICE_CACHE", "id": "<run `wrangler kv namespace create PRICE_CACHE`>" }
 *   ]
 *
 * Then regenerate types with `npm run cf-typegen` so `Env` includes
 * `PRICE_CACHE: KVNamespace` automatically.
 */

// ---------- Types ----------

interface RimiProduct {
	id: string;
	name: string;
	price: string;
	pricePer: string;
	img: string;
	url: string;
	oldPrice: string;
}

interface LidlProduct {
	id: string;
	name: string;
	price: string;
	oldPrice: string;
	brand: string;
	img: string;
	url: string;
	hasDiscount: boolean;
	pricePer: string;
}

interface BarboraCacheEntry {
	body: string;
	contentType: string;
	status: number;
}

interface IkiProduct {
	id?: string;
	frontEndProduct?: { id?: string };
	[key: string]: unknown;
}

// ---------- Cache helpers ----------
// All cache functions are defensive: if PRICE_CACHE isn't bound yet, they
// silently fall through to a live fetch instead of throwing.

const CACHE_TTL_SECONDS = 60 * 60 * 12; // 12h default — tune to how often prices actually change

async function hashKey(str: string): Promise<string> {
	const data = new TextEncoder().encode(str);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getCached<T>(env: Env, key: string): Promise<T | null> {
	if (!env.PRICE_CACHE) return null;
	try {
		const result = await env.PRICE_CACHE.get(key, { type: 'json' });
		return (result as T) ?? null;
	} catch (e) {
		return null; // KV unavailable — fall through to a live fetch
	}
}

function putCached(env: Env, ctx: ExecutionContext, key: string, value: unknown, ttl: number = CACHE_TTL_SECONDS): void {
	if (!env.PRICE_CACHE) return;
	ctx.waitUntil(
		env.PRICE_CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl }).catch(() => {})
	);
}

function jsonResponse(body: unknown, extraHeaders: Record<string, string> = {}): Response {
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

function corsHeaders(request: Request, allowHeaders: string = 'Content-Type', allowMethods: string = 'GET, POST, OPTIONS'): Headers {
	const origin = request.headers ? request.headers.get('Origin') : null;
	return new Headers({
		'Access-Control-Allow-Origin': origin || '*',
		Vary: 'Origin',
		'Access-Control-Allow-Methods': allowMethods,
		'Access-Control-Allow-Headers': allowHeaders,
	});
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// Only allow GET, POST, and OPTIONS
		if (!['GET', 'POST', 'OPTIONS'].includes(request.method)) {
			return new Response('Method not allowed', { status: 405 });
		}

		// Parse the target URL from the query string (?url=...)
		let target: string | null;
		let cookie: string | null;
		let forceRefreshQS: boolean;
		try {
			const url = new URL(request.url);
			target = url.searchParams.get('url');
			cookie = url.searchParams.get('cookie');
			forceRefreshQS = url.searchParams.get('forceRefresh') === '1';
		} catch (e) {
			target = null;
			cookie = null;
			forceRefreshQS = false;
		}
		if (!target) {
			return new Response('Missing url param', { status: 400 });
		}

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			const reqHeaders = request.headers.get('Access-Control-Request-Headers') || 'Content-Type';
			const reqMethod = request.headers.get('Access-Control-Request-Method') || 'POST, GET';
			return new Response(null, {
				status: 204,
				headers: corsHeaders(request, reqHeaders, reqMethod),
			});
		}

		// Barbora HTML scraping (if public search page)
		if (/barbora\.lt\//i.test(target)) {
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

		// Enhanced batching for LastMile/IKI: allow POST body with { multi: [{ text, fromIndexes: [0,200,...] }], params }
		if (/lastmile|frontend-products/i.test(target) && request.method === 'POST') {
			let body: { multi?: { text: string; fromIndexes?: number[] }[]; params?: Record<string, unknown>; forceRefresh?: boolean } | null;
			try {
				body = await request.json();
			} catch (e) {
				body = null;
			}
			if (body && Array.isArray(body.multi)) {
				const params = body.params || {};
				const forceRefresh = !!body.forceRefresh || forceRefreshQS;
				const cacheKey = 'ikilastmile:' + (await hashKey(target + '|' + JSON.stringify({ multi: body.multi, params })));

				if (!forceRefresh) {
					const cached = await getCached<{ products: IkiProduct[] }>(env, cacheKey);
					if (cached) return jsonResponse(cached, { 'X-Cache': 'HIT' });
				}

				// Multi-query, multi-page batching with early stop on empty page
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
				// Deduplicate products
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
		}

		// Lidl batching: accept POST { query, maxPages } and fetch all pages server-side,
		// parse products via regex and return compact JSON.
		if (/lidl\.lt.*\/q\/search/i.test(target) && request.method === 'POST') {
			let body: { query?: string; maxPages?: number; forceRefresh?: boolean } | null;
			try {
				body = await request.json();
			} catch (e) {
				body = null;
			}
			if (body && body.query) {
				const query = body.query;
				const maxPages = Math.max(1, Math.min(parseInt(String(body.maxPages)) || 3, 10));
				const forceRefresh = !!body.forceRefresh || forceRefreshQS;
				const cacheKey = `lidl:${query.toLowerCase()}:${maxPages}`;

				if (!forceRefresh) {
					const cached = await getCached<{ products: LidlProduct[] }>(env, cacheKey);
					if (cached) return jsonResponse(cached, { 'X-Cache': 'HIT' });
				}

				// NOTE: this UA must be a complete, realistic browser string. A
				// truncated UA ("...AppleWebKit/537.36" with no Chrome/Safari tail)
				// looks like a fake/bot UA and gets served a stripped page with no
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

				// Deduplicate by id
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
		}

		// Rimi batching: accept POST { query, maxPages } and fetch all pages server-side,
		// parse products via regex and return compact JSON (avoids sending ~20MB of raw HTML).
		if (/rimi\.lt\/e-parduotuve\/lt\/paieska/i.test(target) && request.method === 'POST') {
			let body: { query?: string; maxPages?: number; forceRefresh?: boolean } | null;
			try {
				body = await request.json();
			} catch (e) {
				body = null;
			}
			if (body && body.query) {
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

				// Fetch all pages in parallel, then stop at first empty page
				const htmlPagesRaw = await Promise.all(urls.map((url) => fetch(url, { headers }).then((r) => r.text())));

				let allProducts: RimiProduct[] = [];
				for (const html of htmlPagesRaw) {
					const parsed = parseRimiProductsFromHtml(html);
					if (parsed.length === 0) break;
					allProducts.push(...parsed);
				}

				// Deduplicate by id
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
		}

		// Generic proxy for other requests (mainly for LastMile/IKI)
		const reqHeaders = new Headers(request.headers);
		reqHeaders.delete('host');
		reqHeaders.delete('content-length');
		reqHeaders.delete('cookie');
		reqHeaders.delete('cf-connecting-ip');
		reqHeaders.delete('cf-ipcountry');
		reqHeaders.delete('cf-ray');
		reqHeaders.delete('x-forwarded-for');
		reqHeaders.delete('x-real-ip');
		const init: RequestInit = {
			method: request.method,
			headers: reqHeaders,
			body: request.method === 'POST' ? request.body : undefined,
		};
		const response = await fetch(target, init);
		const respHeaders = new Headers(response.headers);
		const origin = request.headers.get('Origin');
		respHeaders.set('Access-Control-Allow-Origin', origin || '*');
		respHeaders.set('Vary', 'Origin');
		respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		respHeaders.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
		return new Response(response.body, {
			status: response.status,
			headers: respHeaders,
		});
	},
} satisfies ExportedHandler<Env>;

// Regex-based Rimi product parser — avoids sending raw HTML to the client.
// Each product block starts at data-product-code= so we split on that.
function parseRimiProductsFromHtml(html: string): RimiProduct[] {
	const products: RimiProduct[] = [];
	// Split into per-product chunks; each starts just before data-product-code
	const chunks = html.split(/(?=data-product-code=")/);

	for (const chunk of chunks) {
		const idMatch = chunk.match(/^data-product-code="([^"]+)"/);
		if (!idMatch) continue;
		const id = idMatch[1];

		// data-gtm-eec-product JSON contains name and current (possibly discounted) price
		let name = '';
		let price = '';
		const jsonMatch = chunk.match(/data-gtm-eec-product='([^']+)'/);
		if (jsonMatch) {
			try {
				const meta = JSON.parse(jsonMatch[1]);
				name = meta.name || '';
				price = meta.price !== undefined ? String(meta.price) : '';
			} catch (e) {
				/* ignore */
			}
		}
		// Fallback name from the banner title attribute
		if (!name) {
			const titleMatch = chunk.match(/data-gtms-banner-title="([^"]+)"/);
			if (titleMatch) name = titleMatch[1];
		}

		// Skip out-of-stock products (no price-tag, only "Šiuo metu prekės nėra")
		if (chunk.includes('\u0160iuo metu prek\u0117s n\u0117ra') && !chunk.includes('price-tag card__price')) {
			continue;
		}

		// Product image (data-src on the product image, not badge images)
		const imgMatch = chunk.match(/data-src="(https:\/\/rimibaltic-res[^"]+)"/);
		const img = imgMatch ? imgMatch[1] : '';

		// Product page URL
		const urlMatch = chunk.match(/href="(\/e-parduotuve\/lt\/produktai\/[^"]+)"/);
		const url = urlMatch ? 'https://www.rimi.lt' + urlMatch[1] : '';

		// Old price — only present when card__price-wrapper has -has-discount class
		let oldPrice = '';
		if (chunk.includes('-has-discount')) {
			// aria-hidden span inside old-price-tag contains e.g. "0,65€"
			const oldMatch = chunk.match(/old-price-tag[^>]*>[\s\S]{0,300}?aria-hidden="true">([^<]{1,20})</);
			if (oldMatch) oldPrice = oldMatch[1].replace('€', '').trim();
		}

		// Unit price from aria-hidden span inside card__price-per e.g. "7,14\n€/kg"
		let pricePer = '';
		const ppMatch = chunk.match(/card__price-per[\s\S]{0,400}?aria-hidden="true">([\s\S]{0,100}?)<\/span>/);
		if (ppMatch) pricePer = ppMatch[1].replace(/\s+/g, ' ').trim();

		products.push({ id, name, price, pricePer, img, url, oldPrice });
	}
	return products;
}

// Lidl product parser. Lidl embeds product data two different ways depending
// on how the page is served:
//   1) data-grid-data  — the FULL product object (price/oldPrice, canonical
//      URL, image, stock+badge info, etc.) — this is what's present when the
//      request looks like a real browser and gets the full SSR page.
//   2) data-gridbox-impression — a much lighter analytics-only blob (id, name,
//      price, brand) with no image/url/badge info, requiring those to be
//      scraped separately from the surrounding markup.
// We prefer (1) when present and fall back to (2) + markup-scraping otherwise.
function parseLidlProductsFromHtml(html: string): LidlProduct[] {
	const products: LidlProduct[] = [];

	function decodeAttr(raw: string): string {
		// Handles both encodings seen in the wild: HTML-entity-escaped
		// (&quot;...&quot;) and percent-encoded (%7B%22...%7D), including the
		// double percent-encoded case (%257B...).
		let s = raw
			.replace(/&quot;/g, '"')
			.replace(/&#x27;/g, "'")
			.replace(/&#39;/g, "'")
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>');
		try {
			s = decodeURIComponent(s);
		} catch (e) {
			/* not percent-encoded, ignore */
		}
		if (s.startsWith('%7B') || s.startsWith('%7b')) {
			try {
				s = decodeURIComponent(s);
			} catch (e) {
				/* ignore */
			}
		}
		return s;
	}

	// Lookahead split keeps each product's own opening <div ...> tag (and
	// whichever data attribute it carries) inside its own chunk, instead of
	// having it consumed as part of the delimiter match.
	const chunks = html.split(/(?=<div[^>]*class="odsc-tile odsc-tile--variant-borderless[^"]*product-grid-box")/);

	for (const chunk of chunks) {
		let id = '';
		let name = '';
		let price = '';
		let oldPrice = '';
		let brand = '';
		let img = '';
		let url = '';
		let pricePer = '';
		let hasDiscount = false;
		let matched = false;

		// --- Preferred: rich data-grid-data attribute ---
		const richMatch = chunk.match(/data-grid-data=(?:"([^"]+)"|'([^']+)')/);
		if (richMatch) {
			try {
				const meta = JSON.parse(decodeAttr(richMatch[1] || richMatch[2]));
				id = String(meta.itemId || meta.productId || meta.erpNumber || '');
				if (id) {
					matched = true;
					name = meta.title || meta.fullTitle || meta.keyfacts?.title || '';
					brand = meta.brand?.name || '';
					const priceObj = meta.price || {};
					price = priceObj.price !== undefined ? String(priceObj.price) : '';
					oldPrice = priceObj.oldPrice ? String(priceObj.oldPrice) : '';
					pricePer = priceObj.basePrice?.text || '';
					img = meta.image || meta.image_V1?.image || '';
					url = meta.canonicalPath || meta.canonicalUrl || '';
					const badges = meta.stockAvailability?.badgeInfo?.badges || [];
					hasDiscount = badges.length > 0 || !!priceObj.discount?.showDiscount;
				}
			} catch (e) {
				/* fall through to light data below */
			}
		}

		// --- Fallback: lighter data-gridbox-impression + scraped markup ---
		if (!matched) {
			const lightMatch = chunk.match(/data-gridbox-impression=(?:"([^"]+)"|'([^']+)')/);
			if (!lightMatch) continue;
			try {
				const meta = JSON.parse(decodeAttr(lightMatch[1] || lightMatch[2]));
				id = String(meta.id || '');
				if (!id) continue;
				name = meta.name || '';
				brand = meta.brand || '';
				price = meta.price !== undefined ? String(meta.price) : '';
			} catch (e) {
				continue;
			}

			const urlMatch = chunk.match(/class="odsc-tile__link"[^>]*href="([^"]+)"/);
			if (urlMatch) url = urlMatch[1].split('#')[0]; // strip tracking params after #

			const imgMatch = chunk.match(/class="odsc-image-gallery__image"[^>]*src="([^"]+)"/);
			if (imgMatch) img = imgMatch[1];

			// Discount products carry a date-range badge with this class
			hasDiscount = /class="ods-badge[^"]*ods-badge--appearance-blue[^"]*"/.test(chunk);
		}

		if (!id) continue;
		if (url && !url.startsWith('http')) url = 'https://www.lidl.lt' + url;

		products.push({ id, name, price, oldPrice, brand, img, url, hasDiscount, pricePer });
	}

	// Dedup by id (defensive — shouldn't normally collide, but pagination
	// overlap or a page matching both attribute types per tile could)
	const seen = new Set<string>();
	return products.filter((p) => {
		if (seen.has(p.id)) return false;
		seen.add(p.id);
		return true;
	});
}