import { describe, it, expect } from 'vitest';
import { parseLidlProductsFromHtml } from '../src/parsers/lidl';
import { mergeFlyerOffers } from '../src/lidlFlyers';

// A search-result tile in lidl.lt's current markup, with its metadata JSON in
// an HTML-escaped data-grid-data attribute
function tile(meta: object): string {
	const attr = JSON.stringify(meta).replace(/"/g, '&quot;');
	return `<div class="odsc-tile odsc-tile--variant-default odsc-tile--label-yellow tile-without-padding" data-grid-data="${attr}"><div class="odsc-tile__inner"></div></div>`;
}

function offer(overrides: Record<string, unknown>) {
	return {
		product_id: '1',
		article_no: '1',
		brand: null,
		name: 'Prekė',
		variant: null,
		quantity: null,
		price: 1,
		regular_price: null,
		discount_percent: null,
		lidl_plus: false,
		unit_price: null,
		unit: null,
		valid_from: '2000-01-01',
		valid_to: '2999-12-31',
		conditions: null,
		flyer: 'maisto-prekiu-pasiulymai-20261012-kw42-pr',
		page: 3,
		price_verified: true,
		page_image: null,
		box: null,
		...overrides,
	} as Parameters<typeof mergeFlyerOffers>[1][number];
}

describe('parseLidlProductsFromHtml', () => {
	it('parses every tile, with article numbers and Lidl Plus-only prices', () => {
		const html =
			'<div class="odsc-tile-grid">' +
			tile({ itemId: 11255041, title: 'Sūris Emmentaler riekelėmis', ians: ['19065'], price: { price: 1.39, oldPrice: 1.79 } }) +
			tile({ itemId: 11432516, title: 'Pienas', ians: ['5576041'], price: {}, lidlPlus: [{ price: { price: 0.39 } }] }) +
			'</div>';

		const products = parseLidlProductsFromHtml(html);

		expect(products.map((p) => [p.id, p.price, p.lidlPlus, p.ians])).toEqual([
			['11255041', '1.39', false, ['19065']],
			['11432516', '0.39', true, ['5576041']],
		]);
	});
});

describe('mergeFlyerOffers', () => {
	const searchProduct = parseLidlProductsFromHtml(tile({ itemId: 11432516, title: 'Pienas', ians: ['5576041'], price: { price: 0.79 } }))[0];

	it('attaches the flyer offer to the search product with the same article number', () => {
		const milk = offer({ product_id: '5576041', article_no: '5576041', name: 'Pienas UAT', price: 0.39, lidl_plus: true, conditions: 'limitas 12 vnt.' });

		const [product] = mergeFlyerOffers([searchProduct], [milk], 'pienas');

		expect(product.id).toBe('11432516');
		expect(product.price).toBe('0.79'); // lidl.lt's own fields are kept
		expect(product.flyer).toMatchObject({ price: 0.39, lidlPlus: true, conditions: 'limitas 12 vnt.' });
	});

	it('adds flyer offers that match the query, ignoring case and Lithuanian letters', () => {
		const pageImage = { url: 'https://imgproxy.leaflets.schwarz/sig/page-18.jpg', width: 721, height: 1200 };
		const box = { x: 0.68, y: 0.29, width: 0.32, height: 0.2 };
		const feta = offer({
			product_id: '6211913',
			article_no: '6211913',
			brand: 'DELUXE',
			name: 'Graikiškas fetos sūris',
			unit_price: 17.45,
			unit: 'kg',
			page_image: pageImage,
			box,
		});
		const mango = offer({ product_id: '80713', article_no: '80713', name: 'Mangas' });

		const products = mergeFlyerOffers([], [feta, mango], 'Suris deluxe');

		expect(products).toHaveLength(1);
		expect(products[0]).toMatchObject({
			id: 'flyer-6211913',
			source: 'flyer',
			brand: 'DELUXE',
			pricePer: '1 kg = 17,45 €',
			url: 'https://www.lidl.lt/l/lt/leidinys/maisto-prekiu-pasiulymai-20261012-kw42-pr/view/flyer/page/3',
			flyer: { pageImage, box },
		});
	});

	it('lists each flyer product once', () => {
		const onPage3 = offer({ product_id: '5576041', article_no: '5576041', name: 'Pienas', page: 3 });
		const onPage9 = offer({ product_id: '5576041', article_no: '5576041', name: 'Pienas', page: 9 });
		const other = offer({ product_id: '7600379', article_no: '7600379', name: 'Avižų pienas' });

		const products = mergeFlyerOffers([searchProduct], [onPage3, onPage9, other], 'pienas');

		expect(products.map((p) => p.id)).toEqual(['11432516', 'flyer-7600379']);
	});

	it('leaves out offers that have already ended', () => {
		const ended = offer({ product_id: '5576041', article_no: '5576041', name: 'Pienas', valid_to: '2000-01-02' });

		const products = mergeFlyerOffers([searchProduct], [ended], 'pienas');

		expect(products).toEqual([searchProduct]);
	});
});
