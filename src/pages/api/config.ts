import type { APIRoute } from "astro";
import { fetchConfig, putConfig, invalidateSectionsCache } from "../../lib/s3";

export const GET: APIRoute = async () => {
	try {
		const config = await fetchConfig();
		return new Response(JSON.stringify(config), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err.message }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
};

export const PUT: APIRoute = async ({ request }) => {
	try {
		const body = (await request.json()) as { sections?: string[] };
		if (!body?.sections) {
			return new Response(JSON.stringify({ error: "Invalid config" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}
		// Save raw folder names (server generates slug/label from folder name)
		await putConfig({ sections: body.sections });
		invalidateSectionsCache();
		return new Response(JSON.stringify({ ok: true }), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err.message }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
};