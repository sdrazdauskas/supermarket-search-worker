import type { LidlFlyerOffer, LidlProduct } from './types';
import { getCached, putCached } from './cache';

// Lidl's weekly flyer offers, from the lidl-price-tracker worker (a separate
// project that reads the flyer PDFs). lidl.lt search only lists part of the
// week's deals and leaves out Lidl Plus conditions, so the flyer data is used
// to annotate search results and to add the flyer deals search didn't return.
// API docs: "Lidl Price Tracker API: guide for UI developers".

const CURRENT_FLYERS_URL = 'https://lidl-price-tracker.sh4rdknight.workers.dev/api/flyers/current';
const CACHE_KEY = 'lidl-flyers:v2:current'; // v2: Lidl's flyers only
// The tracker rebuilds this response after each processing run (every 15 min
// while a new flyer is being read), so a longer TTL would show stale progress.
const CACHE_TTL_SECONDS = 60 * 15;
const FETCH_TIMEOUT_MS = 5000;

// An offer as the tracker API returns it
interface TrackerOffer {
	product_id: string;
	article_no: string | null;
	brand: string | null;
	name: string;
	variant: string | null;
	quantity: string | null;
	price: number;
	regular_price: number | null;
	discount_percent: number | null;
	lidl_plus: boolean;
	unit_price: number | null;
	unit: string | null;
	valid_from: string;
	valid_to: string;
	conditions: string | null;
	flyer: string;
	page: number;
	price_verified: boolean | null;
	page_image: { url: string; width: number | null; height: number | null } | null;
	box: { x: number; y: number; width: number; height: number } | null;
}

interface TrackerCurrentResponse {
	// Flyers running today. The response also has `upcoming` (next week's flyers,
	// published on Saturday), left out here so they don't mix with today's deals.
	flyers: { store: 'lidl' | 'norfa'; status: 'pending' | 'done' | 'failed'; offers: TrackerOffer[] }[];
}

export interface CurrentFlyers {
	pending: boolean; // a flyer is still being read, so its offer list is incomplete
	offers: TrackerOffer[]; // in flyer order
}

// Returns null if the tracker can't be reached — callers carry on without flyer data.
export async function getCurrentFlyers(env: Env, ctx: ExecutionContext, forceRefresh: boolean): Promise<CurrentFlyers | null> {
	if (!forceRefresh) {
		const cached = await getCached<CurrentFlyers>(env, CACHE_KEY);
		if (cached) return cached;
	}

	let data: TrackerCurrentResponse;
	try {
		const resp = await fetch(CURRENT_FLYERS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!resp.ok) return null;
		data = await resp.json<TrackerCurrentResponse>();
	} catch (e) {
		return null;
	}

	// The tracker also serves Norfa's flyers; only Lidl's belong in Lidl results
	const flyers = data.flyers.filter((f) => f.store === 'lidl');
	const result: CurrentFlyers = {
		pending: flyers.some((f) => f.status === 'pending'),
		offers: flyers.flatMap((f) => f.offers),
	};
	putCached(env, ctx, CACHE_KEY, result, CACHE_TTL_SECONDS);
	return result;
}

// Attaches flyer offers to the search products they belong to (matched by
// article number), then appends the flyer offers that match the query but
// weren't in the search results.
export function mergeFlyerOffers(products: LidlProduct[], offers: TrackerOffer[], query: string): LidlProduct[] {
	// The tracker's list is rebuilt once a day, so between midnight and its next
	// rebuild it can still hold offers that ended yesterday.
	const today = vilniusToday();
	const current = offers.filter((o) => o.valid_to >= today);

	const byArticleNo = new Map<string, TrackerOffer>();
	for (const offer of current) {
		if (!offer.article_no) continue;
		const key = articleKey(offer.article_no);
		if (!byArticleNo.has(key)) byArticleNo.set(key, offer);
	}

	const used = new Set<string>(); // tracker product ids already in the result
	const merged = products.map((product) => {
		const offer = product.ians.map((ian) => byArticleNo.get(articleKey(ian))).find((o) => o !== undefined);
		if (!offer) return product;
		used.add(offer.product_id);
		return { ...product, flyer: toFlyerOffer(offer) };
	});

	const words = fold(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return merged;
	for (const offer of current) {
		// `used` also drops a product's second offer when it's printed on two pages
		if (used.has(offer.product_id) || !matchesQuery(offer, words)) continue;
		used.add(offer.product_id);
		merged.push(toProduct(offer));
	}
	return merged;
}

function toFlyerOffer(o: TrackerOffer): LidlFlyerOffer {
	return {
		productId: o.product_id,
		price: o.price,
		regularPrice: o.regular_price,
		discountPercent: o.discount_percent,
		lidlPlus: o.lidl_plus,
		conditions: o.conditions,
		variant: o.variant,
		quantity: o.quantity,
		unitPrice: o.unit_price,
		unit: o.unit,
		validFrom: o.valid_from,
		validTo: o.valid_to,
		priceVerified: o.price_verified,
		pageUrl: `https://www.lidl.lt/l/lt/leidinys/${o.flyer}/view/flyer/page/${o.page}`,
		pageImage: o.page_image,
		box: o.box,
	};
}

// A flyer-only offer in the same shape as a scraped search product
function toProduct(o: TrackerOffer): LidlProduct {
	const flyer = toFlyerOffer(o);
	return {
		id: `flyer-${o.product_id}`,
		name: o.name,
		price: String(o.price),
		oldPrice: o.regular_price !== null ? String(o.regular_price) : '',
		brand: o.brand ?? '',
		img: '', // no product photo — crop flyer.pageImage to flyer.box instead
		url: flyer.pageUrl,
		hasDiscount: o.regular_price !== null || o.discount_percent !== null || o.lidl_plus,
		// same format as lidl.lt's own per-unit text, e.g. "1 kg = 9,27 €"
		pricePer: o.unit_price !== null && o.unit ? `1 ${o.unit} = ${o.unit_price.toFixed(2).replace('.', ',')} €` : '',
		lidlPlus: o.lidl_plus,
		ians: o.article_no ? [o.article_no] : [],
		source: 'flyer',
		flyer,
	};
}

// Same rules as the tracker's own search: case and Lithuanian letters don't
// matter, and every query word has to appear in the brand, name, variant or
// article number.
function matchesQuery(o: TrackerOffer, words: string[]): boolean {
	const text = fold([o.brand, o.name, o.variant, o.article_no].filter(Boolean).join(' '));
	return words.every((w) => text.includes(w));
}

function fold(s: string): string {
	return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function articleKey(articleNo: string): string {
	return articleNo.replace(/^0+/, '');
}

function vilniusToday(): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius' }).format(new Date()); // "YYYY-MM-DD"
}
