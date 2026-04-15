import type { APIRoute } from "astro";
import { PARA_SECTIONS, putPin, deletePin } from "../../lib/s3";

/**
 * POST /api/pin — create a .pin file to pin a folder
 * DELETE /api/pin — remove the .pin file to unpin a folder
 *
 * Body: { "section": "areas", "folderPath": "english" }
 */

export const POST: APIRoute = async ({ request }) => {
	try {
		const { section, folderPath } = await request.json();

		const sectionMeta = PARA_SECTIONS.find((s) => s.slug === section);
		if (!sectionMeta || !folderPath) {
			return new Response(
				JSON.stringify({ error: "Invalid section or folderPath" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		await putPin(sectionMeta.prefix, folderPath);

		return new Response(JSON.stringify({ ok: true, pinned: true }), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err.message }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
};

export const DELETE: APIRoute = async ({ request }) => {
	try {
		const { section, folderPath } = await request.json();

		const sectionMeta = PARA_SECTIONS.find((s) => s.slug === section);
		if (!sectionMeta || !folderPath) {
			return new Response(
				JSON.stringify({ error: "Invalid section or folderPath" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		await deletePin(sectionMeta.prefix, folderPath);

		return new Response(JSON.stringify({ ok: true, pinned: false }), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err.message }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
};
