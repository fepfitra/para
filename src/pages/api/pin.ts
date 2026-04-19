import type { APIRoute } from "astro";
import { SECTIONS, putPin, deletePin } from "../../lib/s3";

/**
 * POST /api/pin — create a .pin file to pin a folder
 * DELETE /api/pin — remove the .pin file to unpin a folder
 *
 * Body: { "section": "areas", "folderPath": "english" }
 */

export const POST: APIRoute = async ({ request }) => {
	try {
		const { section, folderPath } = await request.json();

		if (!folderPath) {
			return new Response(
				JSON.stringify({ error: "Missing folderPath" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		const sectionMeta = SECTIONS.find((s) => s.slug === section);
		if (!sectionMeta) {
			return new Response(
				JSON.stringify({
					error: `Section "${section}" is not defined. Available: ${SECTIONS.map((s) => s.slug).join(", ")}`,
				}),
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

		if (!folderPath) {
			return new Response(
				JSON.stringify({ error: "Missing folderPath" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		const sectionMeta = SECTIONS.find((s) => s.slug === section);
		if (!sectionMeta) {
			return new Response(
				JSON.stringify({
					error: `Section "${section}" is not defined. Available: ${SECTIONS.map((s) => s.slug).join(", ")}`,
				}),
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
