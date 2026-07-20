export function corsHeaders(request: Request, allowHeaders: string = 'Content-Type', allowMethods: string = 'GET, POST, OPTIONS'): Headers {
	const origin = request.headers ? request.headers.get('Origin') : null;
	return new Headers({
		'Access-Control-Allow-Origin': origin || '*',
		Vary: 'Origin',
		'Access-Control-Allow-Methods': allowMethods,
		'Access-Control-Allow-Headers': allowHeaders,
	});
}
