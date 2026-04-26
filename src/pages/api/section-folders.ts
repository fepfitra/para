import type { APIRoute } from "astro";
import { listSectionFolders } from "../../lib/s3";

export const GET: APIRoute = async () => {
	try {
		// List top-level folders from root (empty prefix, delimiter /)
		const folders = await listSectionFolders("");
		return new Response(JSON.stringify(folders.map(f => f.folder)), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err.message }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
};