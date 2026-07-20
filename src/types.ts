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
}

export interface NorfaProduct {
	id: string;
	name: string;
	price: string; // e.g. "1.19"
	pricePer: string; // per-unit text, e.g. "5,95 Eur/kg" — either scraped from the
	// page's own note, or (when no note exists) the item's own price re-labeled
	// as a per-unit value, since that's most often what it already is
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
