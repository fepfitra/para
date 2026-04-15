import {
	S3Client,
	ListObjectsV2Command,
	GetObjectCommand,
} from "@aws-sdk/client-s3";

const client = new S3Client({
	region: import.meta.env.S3_REGION || "eu-central-1",
	endpoint: import.meta.env.S3_ENDPOINT || "https://s3.g.s4.mega.io",
	credentials: {
		accessKeyId: import.meta.env.S3_ACCESS_KEY,
		secretAccessKey: import.meta.env.S3_SECRET_KEY,
	},
});

const BUCKET = import.meta.env.S3_BUCKET || "obsidian";

export const PARA_SECTIONS = [
	{ prefix: "1. Projects/", slug: "projects", label: "Projects" },
	{ prefix: "2. Areas/", slug: "areas", label: "Areas" },
	{ prefix: "3. Resources/", slug: "resources", label: "Resources" },
	{ prefix: "4. Archives/", slug: "archives", label: "Archives" },
] as const;

export interface S3Entry {
	key: string;
	slug: string;
	title: string;
	size: number;
	segments: string[];
}

// --- In-memory cache (TTL-based) ---
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const listCache = new Map<string, { data: S3Entry[]; ts: number }>();

function slugify(key: string, prefix: string): string {
	const rel = key.slice(prefix.length).replace(/\.md$/, "");
	return rel
		.split("/")
		.map((s) =>
			s
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, ""),
		)
		.filter(Boolean)
		.join("/");
}

function titleFromFilename(key: string): string {
	const filename = key.split("/").pop()!;
	return filename
		.replace(/\.md$/, "")
		.replace(/[_-]+/g, " ")
		.replace(/(?:^|\s)\w/g, (c) => c.toUpperCase());
}

/**
 * List all .md entries under a PARA section prefix.
 * Results are cached in memory for 5 minutes.
 */
export async function listSection(prefix: string): Promise<S3Entry[]> {
	const cached = listCache.get(prefix);
	if (cached && Date.now() - cached.ts < CACHE_TTL) {
		return cached.data;
	}

	const entries: S3Entry[] = [];
	let token: string | undefined;

	do {
		const res = await client.send(
			new ListObjectsV2Command({
				Bucket: BUCKET,
				Prefix: prefix,
				ContinuationToken: token,
			}),
		);

		for (const obj of res.Contents ?? []) {
			const key = obj.Key!;
			if (!key.endsWith(".md") || key === prefix) continue;

			const rel = key.slice(prefix.length).replace(/\.md$/, "");
			entries.push({
				key,
				slug: slugify(key, prefix),
				title: titleFromFilename(key),
				size: obj.Size ?? 0,
				segments: rel.split("/").filter(Boolean),
			});
		}

		token = res.NextContinuationToken;
	} while (token);

	listCache.set(prefix, { data: entries, ts: Date.now() });
	return entries;
}

/**
 * Fetch a single markdown file's content from S3.
 */
export async function fetchMarkdown(key: string): Promise<string> {
	const res = await client.send(
		new GetObjectCommand({ Bucket: BUCKET, Key: key }),
	);
	return res.Body!.transformToString();
}

/**
 * Given a section slug and page slug, find the matching S3 key.
 */
export async function resolveKey(
	sectionSlug: string,
	pageSlug: string,
): Promise<{ key: string; title: string } | null> {
	const section = PARA_SECTIONS.find((s) => s.slug === sectionSlug);
	if (!section) return null;

	const entries = await listSection(section.prefix);
	const entry = entries.find((e) => e.slug === pageSlug);
	return entry ? { key: entry.key, title: entry.title } : null;
}

/**
 * Build a tree structure from flat entries for sidebar rendering.
 */
export interface SidebarNode {
	label: string;
	slug?: string;
	children: SidebarNode[];
}

export function buildTree(entries: S3Entry[], sectionSlug: string): SidebarNode[] {
	const root: SidebarNode[] = [];

	for (const entry of entries) {
		let current = root;
		const parts = entry.segments;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i]!;
			const isLast = i === parts.length - 1;

			if (isLast) {
				current.push({
					label: entry.title,
					slug: `/${sectionSlug}/${entry.slug}`,
					children: [],
				});
			} else {
				let folder = current.find(
					(n) => !n.slug && n.label === part,
				);
				if (!folder) {
					folder = { label: part, children: [] };
					current.push(folder);
				}
				current = folder.children;
			}
		}
	}

	return root;
}
