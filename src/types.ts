export interface RimiProduct {
	id: string;
	name: string;
	price: string;
	pricePer: string;
	img: string;
	url: string;
	oldPrice: string;
}

export interface LidlProduct {
	id: string;
	name: string;
	price: string;
	oldPrice: string;
	brand: string;
	img: string;
	url: string;
	hasDiscount: boolean;
	pricePer: string;
	lidlPlus: boolean; // `price` is only paid with the Lidl Plus app
	ians: string[]; // Lidl article numbers — the number printed under the product in the flyer
	// 'search' = from lidl.lt search; 'flyer' = only found in a weekly flyer
	// (no image, and `url` opens the flyer page instead of a product page)
	source: 'search' | 'flyer';
	flyer?: LidlFlyerOffer; // set when the product is in a current weekly flyer
}

// An offer from Lidl's weekly flyer, as read by the lidl-price-tracker worker
// (https://lidl-price-tracker.sh4rdknight.workers.dev).
export interface LidlFlyerOffer {
	productId: string; // for the tracker's /api/products/:id price history
	price: number;
	regularPrice: number | null; // price without Lidl Plus / before discount
	discountPercent: number | null;
	lidlPlus: boolean;
	// How the price applies, as printed (e.g. "perkant 2 vnt."). Sometimes the
	// headline price only holds under it, so it should be shown next to the price.
	conditions: string | null;
	variant: string | null;
	quantity: string | null; // pack size, e.g. "500 g"
	unitPrice: number | null;
	unit: string | null;
	validFrom: string; // "YYYY-MM-DD" — can be later than today (e.g. a Thursday–Sunday deal)
	validTo: string;
	priceVerified: boolean | null; // false = price not found on the printed page, may be misread
	pageUrl: string; // the flyer page in Lidl's online viewer
	// The flyer has no separate product photos: show the product by cropping
	// `pageImage` (a page JPEG served by the tracker, kept after Lidl removes it)
	// to `box`. `box` frames just the product's photo, not its name or price
	pageImage: { url: string; width: number | null; height: number | null } | null;
	box: { x: number; y: number; width: number; height: number } | null; // fractions (0–1) of the image, from the top-left
}

export interface NorfaProduct {
	id: string;
	name: string;
	price: string; // e.g. "1.19"
	pricePer: string; // per-unit text, e.g. "5,95 Eur/kg" — either scraped from the
	// page's own note, or (when no note exists) the item's own price re-labeled
	// as a per-unit value, since that's most often what it already is
	// Shop note on how the price applies, e.g. "Nuolaida taikoma kasoje" (discount
	// applied at the till) or "Taros užstato vertė į gėrimo kainą neįskaičiuota"
	// (bottle deposit not included). No final period.
	note: string | null;
	img: string;
	// Raw ISO dates — deliberately NOT pre-computed into a status here, since the
	// worker response can sit in KV for hours. Status (upcoming/active/expired) is
	// computed by the client at render time against the current date, so it never
	// goes stale between the API's fetch and the user actually seeing the page.
	validFrom: string | null; // "YYYY-MM-DD"
	validTo: string | null; // "YYYY-MM-DD"
}

export interface BarboraCacheEntry {
	body: string;
	contentType: string;
	status: number;
}

export interface IkiProduct {
	id?: string;
	frontEndProduct?: { id?: string };
	[key: string]: unknown;
}
