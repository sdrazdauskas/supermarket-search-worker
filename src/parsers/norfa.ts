import type { NorfaProduct } from '../types';

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

// Norfa's validity dates ("Galioja 07 17-07 19 d.") have no year, so we assume
// the current year in Europe/Vilnius time, with a year-boundary-wrap check
// (e.g. a "12 30-01 02" range spans into next year).
function getVilniusToday(): { y: number; m: number; d: number } {
	const now = new Date();
	const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' });
	const parts = fmt.formatToParts(now);
	const y = parseInt(parts.find((p) => p.type === 'year')!.value, 10);
	const m = parseInt(parts.find((p) => p.type === 'month')!.value, 10);
	const d = parseInt(parts.find((p) => p.type === 'day')!.value, 10);
	return { y, m, d };
}

// Simple sync string hash (FNV-1a) — Norfa's markup has no product code/id, so
// we derive a stable id from name+price+validity window for dedup purposes.
function fnv1a(str: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = (hash * 0x01000193) >>> 0;
	}
	return hash.toString(16);
}

// Norfa product parser — each product sits in its own
// <div class="c-discount-item-list">...</div> block, with price, name, image,
// and a "Galioja <start>-<end> d." (valid <start>-<end>) validity note.
export function parseNorfaProductsFromHtml(html: string): NorfaProduct[] {
	const products: NorfaProduct[] = [];
	const chunks = html.split(/(?=<div class="c-discount-item-list">)/);

	for (const chunk of chunks) {
		if (!chunk.includes('c-product--compact')) continue;

		const imgMatch = chunk.match(/<img src="([^"]+)"/);
		const img = imgMatch ? imgMatch[1] : '';

		const priceMatch = chunk.match(/c-product__price">([^<]+)</);
		const price = priceMatch ? priceMatch[1].replace('€', '').trim() : '';

		const nameMatch = chunk.match(/c-product__name">([^<]+)</);
		const name = nameMatch ? nameMatch[1].replace(/\s+/g, ' ').trim() : '';

		const infoMatch = chunk.match(/c-more-info__content">([\s\S]*?)<\/div>/);
		let pricePer = '';
		let validFrom: string | null = null;
		let validTo: string | null = null;

		if (infoMatch) {
			const normalized = infoMatch[1]
				.replace(/<br\s*\/?>/gi, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			const dateMatch = normalized.match(/Galioja\s+(\d{2})\s+(\d{2})-(\d{2})\s+(\d{2})\s*d\.?/);
			if (dateMatch) {
				pricePer = normalized.slice(0, dateMatch.index).trim();

				const startMonth = parseInt(dateMatch[1], 10);
				const startDay = parseInt(dateMatch[2], 10);
				const endMonth = parseInt(dateMatch[3], 10);
				const endDay = parseInt(dateMatch[4], 10);

				const today = getVilniusToday();
				const startYear = today.y;
				let endYear = today.y;
				if (endMonth < startMonth || (endMonth === startMonth && endDay < startDay)) {
					endYear = startYear + 1; // range wraps across a year boundary
				}
				validFrom = `${startYear}-${pad(startMonth)}-${pad(startDay)}`;
				validTo = `${endYear}-${pad(endMonth)}-${pad(endDay)}`;
			} else {
				pricePer = normalized;
			}
		}

		if (!name) continue;

		// When Norfa doesn't give a separate per-unit ("X Eur/kg") note, the
		// displayed price is most often already a per-unit price itself
		// (e.g. produce sold by weight, single-item pricing) rather than a
		// multi-unit pack total — so fall back to showing the price as its
		// own per-unit value instead of leaving pricePer blank.
		if (!pricePer && price) {
			pricePer = `${price.replace('.', ',')} €/vnt.`;
		}

		const id = fnv1a(`${name}|${price}|${validFrom ?? ''}|${validTo ?? ''}`);
		products.push({ id, name, price, pricePer, img, validFrom, validTo });
	}

	return products;
}
