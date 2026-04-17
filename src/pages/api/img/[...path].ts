import type { APIRoute } from "astro";
import { AwsClient } from "aws4fetch";

const s3 = new AwsClient({
	accessKeyId: import.meta.env.S3_ACCESS_KEY,
	secretAccessKey: import.meta.env.S3_SECRET_KEY,
	region: import.meta.env.S3_REGION || "eu-central-1",
	service: "s3",
});

const ENDPOINT = import.meta.env.S3_ENDPOINT || "https://s3.g.s4.mega.io";
const BUCKET = import.meta.env.S3_BUCKET || "obsidian";

export const GET: APIRoute = async ({ params }) => {
	const path = params.path;
	if (!path) {
		return new Response("Not found", { status: 404 });
	}

	// Security: Only allow image file extensions
	const ext = path.split(".").pop()?.toLowerCase();
	const allowedExts = ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "bmp"];
	if (!ext || !allowedExts.includes(ext)) {
		return new Response("Invalid file type", { status: 400 });
	}

	// Build S3 URL
	const encodedPath = path
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	const url = `${ENDPOINT}/${BUCKET}/${encodedPath}`;

	try {
		const res = await s3.fetch(url);

		if (!res.ok) {
			return new Response("Not found", { status: 404 });
		}

		// Get content type from S3 response
		const contentType = res.headers.get("content-type") || `image/${ext}`;
		const data = await res.arrayBuffer();

		return new Response(data, {
			status: 200,
			headers: {
				"Content-Type": contentType,
				"Cache-Control": "public, max-age=86400", // Cache for 1 day
			},
		});
	} catch (err) {
		console.error("Image proxy error:", err);
		return new Response("Error fetching image", { status: 500 });
	}
};
