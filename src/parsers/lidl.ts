import type { LidlProduct } from '../types';

// Lidl product parser
export function parseLidlProductsFromHtml(html: string): LidlProduct[] {
	const products: LidlProduct[] = [];

	function decodeAttr(raw: string): string {
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

	// One chunk per product tile. Matches any "odsc-tile" variant (Lidl has
	// switched tile classes before), but not inner "odsc-tile__…" parts.
	const chunks = html.split(/(?=<div[^>]*class="odsc-tile[ "])/);

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
		let lidlPlus = false;
		let ians: string[] = [];
		let matched = false;

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
					// Lidl Plus-only deals have no regular price, just the app price
					const lidlPlusPrice = meta.lidlPlus?.[0]?.price?.price;
					if (!price && lidlPlusPrice !== undefined) {
						price = String(lidlPlusPrice);
						lidlPlus = true;
					}
					oldPrice = priceObj.oldPrice ? String(priceObj.oldPrice) : '';
					ians = Array.isArray(meta.ians) ? meta.ians.map(String) : [];
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
			if (urlMatch) url = urlMatch[1].split('#')[0];

			const imgMatch = chunk.match(/class="odsc-image-gallery__image"[^>]*src="([^"]+)"/);
			if (imgMatch) img = imgMatch[1];

			hasDiscount = /class="ods-badge[^"]*ods-badge--appearance-blue[^"]*"/.test(chunk);
		}

		if (!id) continue;
		if (url && !url.startsWith('http')) url = 'https://www.lidl.lt' + url;

		products.push({ id, name, price, oldPrice, brand, img, url, hasDiscount, pricePer, lidlPlus, ians, source: 'search' });
	}

	const seen = new Set<string>();
	return products.filter((p) => {
		if (seen.has(p.id)) return false;
		seen.add(p.id);
		return true;
	});
}
