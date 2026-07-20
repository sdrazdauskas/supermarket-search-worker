/**
 * Grocery price proxy/scraper worker (Barbora, Lidl, Rimi, IKI/LastMile, Norfa),
 * with KV-backed response caching. See ./cache.ts for the caching setup.
 */

import { corsHeaders } from './cors';
import { handleBarboraRoute } from './routes/barbora';
import { handleIkiRoute } from './routes/iki';
import { handleLidlRoute } from './routes/lidl';
import { handleRimiRoute } from './routes/rimi';
import { handleNorfaRoute } from './routes/norfa';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		if (!['GET', 'POST', 'OPTIONS'].includes(request.method)) {
			return new Response('Method not allowed', { status: 405 });
		}

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

		if (request.method === 'OPTIONS') {
			const reqHeaders = request.headers.get('Access-Control-Request-Headers') || 'Content-Type';
			const reqMethod = request.headers.get('Access-Control-Request-Method') || 'POST, GET';
			return new Response(null, {
				status: 204,
				headers: corsHeaders(request, reqHeaders, reqMethod),
			});
		}

		// Barbora HTML scraping (public search page)
		if (/barbora\.lt\//i.test(target)) {
			return handleBarboraRoute(target, cookie, forceRefreshQS, env, ctx);
		}

		// Enhanced batching for LastMile/IKI
		if (/lastmile|frontend-products/i.test(target) && request.method === 'POST') {
			const result = await handleIkiRoute(target, request, forceRefreshQS, env, ctx);
			if (result) return result;
			// else: body wasn't the batched-multi shape — fall through to the generic proxy below
		}

		// Lidl batching
		if (/lidl\.lt.*\/q\/search/i.test(target) && request.method === 'POST') {
			const result = await handleLidlRoute(request, forceRefreshQS, env, ctx);
			if (result) return result;
		}

		// Rimi batching
		if (/rimi\.lt\/e-parduotuve\/lt\/paieska/i.test(target) && request.method === 'POST') {
			const result = await handleRimiRoute(request, forceRefreshQS, env, ctx);
			if (result) return result;
		}

		// Norfa "practical offers" flyer page
		if (/norfa\.lt\/akciju-puslapiai\/praktiski-pasiulymai/i.test(target)) {
			return handleNorfaRoute(target, forceRefreshQS, env, ctx);
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
