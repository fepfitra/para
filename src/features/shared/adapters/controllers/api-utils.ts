export type ApiResult<T = unknown> =
	| { ok: true; data: T }
	| { ok: false; error: string };

export function ok<T>(data: T): ApiResult<T> {
	return { ok: true, data };
}

export function err(error: string): ApiResult<never> {
	return { ok: false, error };
}

export function json<T>(data: T, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export function okJson<T>(data: T): Response {
	return json(ok(data));
}

export function errJson(error: string, status = 500): Response {
	return json(err(error), status);
}

export async function wrapApi<T>(
	fn: () => Promise<T>,
): Promise<Response> {
	try {
		const data = await fn();
		return okJson(data);
	} catch (e: any) {
		return errJson(e.message ?? "Internal error", 500);
	}
}

export async function wrapApiWithBadRequest<T>(
	fn: () => Promise<T>,
): Promise<Response> {
	try {
		const data = await fn();
		return okJson(data);
	} catch (e: any) {
		const status = e.message.includes("not defined") || e.message.includes("Missing") ? 400 : 500;
		return errJson(e.message ?? "Error", status);
	}
}
