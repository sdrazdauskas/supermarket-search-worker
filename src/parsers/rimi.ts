import type { RimiProduct } from '../types';

// Regex-based Rimi product parser
export function parseRimiProductsFromHtml(html: string): RimiProduct[] {
	const products: RimiProduct[] = [];
	const chunks = html.split(/(?=data-product-code=")/);

	for (const chunk of chunks) {
		const idMatch = chunk.match(/^data-product-code="([^"]+)"/);
		if (!idMatch) continue;
		const id = idMatch[1];

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
		if (!name) {
			const titleMatch = chunk.match(/data-gtms-banner-title="([^"]+)"/);
			if (titleMatch) name = titleMatch[1];
		}

		if (chunk.includes('\u0160iuo metu prek\u0117s n\u0117ra') && !chunk.includes('price-tag card__price')) {
			continue;
		}

		const imgMatch = chunk.match(/data-src="(https:\/\/rimibaltic-res[^"]+)"/);
		const img = imgMatch ? imgMatch[1] : '';

		const urlMatch = chunk.match(/href="(\/e-parduotuve\/lt\/produktai\/[^"]+)"/);
		const url = urlMatch ? 'https://www.rimi.lt' + urlMatch[1] : '';

		let oldPrice = '';
		if (chunk.includes('-has-discount')) {
			const oldMatch = chunk.match(/old-price-tag[^>]*>[\s\S]{0,300}?aria-hidden="true">([^<]{1,20})</);
			if (oldMatch) oldPrice = oldMatch[1].replace('€', '').trim();
		}

		let pricePer = '';
		const ppMatch = chunk.match(/card__price-per[\s\S]{0,400}?aria-hidden="true">([\s\S]{0,100}?)<\/span>/);
		if (ppMatch) pricePer = ppMatch[1].replace(/\s+/g, ' ').trim();

		products.push({ id, name, price, pricePer, img, url, oldPrice });
	}
	return products;
}
