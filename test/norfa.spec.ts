import { describe, it, expect } from 'vitest';
import { parseNorfaProductsFromHtml } from '../src/parsers/norfa';

// A product block in norfa.lt's markup; `info` is the "Daugiau informacijos" text
function item(name: string, price: string, info: string): string {
	return `<div class="c-discount-item-list">
		<div class="c-product c-product--compact">
			<div class="c-product__media"><img src="https://products.norfa.lt/storage/products/1.jpg" alt="${name}"></div>
			<div class="c-product__price-stamp"><div class="c-product__price">${price} €</div></div>
			<div data-mh="product-name-1" class="c-product__name">${name}</div>
			<div class="c-more-info">
				<div class="c-more-info__title">Daugiau informacijos</div>
				<div class="c-more-info__content">${info}</div>
			</div>
		</div>
	</div>`;
}

// The parser assumes the current year in Vilnius, since Norfa prints none
const year = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Vilnius', year: 'numeric' }).format(new Date());

describe('parseNorfaProductsFromHtml', () => {
	it('reads the validity dates and decodes the name', () => {
		const name = 'Kavos pupelės JACOBS UGANDA &amp; KENYA, BARISTA ESPRESSO, 1 kg';
		const [product] = parseNorfaProductsFromHtml(item(name, '13.99', `${name} <br> Galioja 10.15-10.28 d.`));

		expect(product).toMatchObject({
			name: 'Kavos pupelės JACOBS UGANDA & KENYA, BARISTA ESPRESSO, 1 kg',
			price: '13.99',
			pricePer: '13,99 €/vnt.', // no unit price on the page, so the price itself
			note: null, // the info text only repeated the name
			validFrom: `${year}-10-15`,
			validTo: `${year}-10-28`,
		});
	});

	it('separates the unit price from the shop note', () => {
		const html = item('Fasuoti špinatai, 125 g/pak.', '0.99', '7,92 Eur/kg <br> Nuolaida taikoma kasoje. <br> Galioja 10.13-10.18 d.');

		const [product] = parseNorfaProductsFromHtml(html);

		expect(product).toMatchObject({ pricePer: '7,92 Eur/kg', note: 'Nuolaida taikoma kasoje.' });
	});

	it('drops reworded product names from the note', () => {
		const html = item(
			'Tirpusis kavos gėrimas MOKATE 3IN1 LIMITED EDITION, 140 g/pak.',
			'1.49',
			'Tirpusis kavos gėrimas MOKATE 3IN1, 140 g/ pak. <br> Galioja 10.15-10.28 d.'
		);

		const [product] = parseNorfaProductsFromHtml(html);

		expect(product.note).toBeNull();
	});

	it('still reads the older date format', () => {
		const [product] = parseNorfaProductsFromHtml(item('Bananai, 1 kg', '0.99', 'Galioja 07 17-07 19 d.'));

		expect([product.validFrom, product.validTo]).toEqual([`${year}-07-17`, `${year}-07-19`]);
	});
});
