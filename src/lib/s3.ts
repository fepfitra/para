import { AwsClient } from "aws4fetch";

declare const process: { env?: Record<string, string | undefined> } | undefined;

const s3 = new AwsClient({
	accessKeyId: import.meta.env.S3_ACCESS_KEY,
	secretAccessKey: import.meta.env.S3_SECRET_KEY,
	region: import.meta.env.S3_REGION || "eu-central-1",
	service: "s3",
});

const ENDPOINT = import.meta.env.S3_ENDPOINT || "https://s3.g.s4.mega.io";
const BUCKET = import.meta.env.S3_BUCKET || "obsidian";
const CONFIG_KEY = "para.json";

export interface ParaConfig {
	sections: string[];
}

function sectionFromPrefix(prefix: string): { prefix: string; slug: string; label: string } {
	const label = prefix.replace(/\/$/, '');
	return {
		prefix: prefix.endsWith('/') ? prefix : prefix + '/',
		slug: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
		label,
	};
}

function sectionsFromConfig(config: ParaConfig | null): { prefix: string; slug: string; label: string }[] | null {
	if (!config?.sections?.length) return null;
	const labels = config.sections.map((s: any) => typeof s === 'string' ? s : s.label ?? s);
	return labels.map((label: string) => sectionFromPrefix(label));
}

export async function fetchConfig(): Promise<ParaConfig | null> {
	const encodedKey = CONFIG_KEY.split("/").map((s) => encodeURIComponent(s)).join("/");
	const url = `${ENDPOINT}/${BUCKET}/${encodedKey}`;
	const res = await s3.fetch(url);
	if (!res.ok) {
		if (res.status === 404) return null;
		throw new Error(`Failed to fetch ${CONFIG_KEY}: ${res.status} ${await res.text()}`);
	}
	const text = await res.text();
	return JSON.parse(text) as ParaConfig;
}

export async function putConfig(config: ParaConfig): Promise<void> {
	const encodedKey = CONFIG_KEY.split("/").map((s) => encodeURIComponent(s)).join("/");
	const url = `${ENDPOINT}/${BUCKET}/${encodedKey}`;
	const body = JSON.stringify(config, null, 2);
	const res = await s3.fetch(url, {
		method: "PUT",
		body,
		headers: { "Content-Type": "application/json" },
	});
	if (!res.ok) {
		throw new Error(`Failed to save ${CONFIG_KEY}: ${res.status} ${await res.text()}`);
	}
}

function parseSectionsFromEnv(): { prefix: string; slug: string; label: string }[] {
	// SECTIONS env var: comma-separated folder names (prefix = folder name + '/')
	// Example: "Projects,Areas,Books" or "1. Projects,2. Areas"
	const envSections = import.meta.env?.SECTIONS || process?.env?.SECTIONS;
	if (!envSections) {
		throw new Error(
			"SECTIONS environment variable is required but not set. " +
				"Format: 'FolderName,FolderName,FolderName' " +
				"Example: 'Projects,Areas,Books'",
		);
	}

	return envSections
		.split(",")
		.map((s: string) => s.trim())
		.filter(Boolean)
		.map((section: string) => sectionFromPrefix(section));
}

export const getSections = async (): Promise<{ prefix: string; slug: string; label: string }[]> => {
	try {
		const config = await fetchConfig();
		const sections = sectionsFromConfig(config);
		if (sections) return sections;
	} catch {
		// Ignore fetch errors
	}
	return [];
};

// Cache for sections after first load
let _sectionsCache: { prefix: string; slug: string; label: string }[] | null = null;
let _sectionsPromise: Promise<{ prefix: string; slug: string; label: string }[]> | null = null;

export async function loadSections(): Promise<{ prefix: string; slug: string; label: string }[]> {
	if (_sectionsCache) return _sectionsCache;
	if (!_sectionsPromise) {
		_sectionsPromise = getSections().then((s) => {
			_sectionsCache = s;
			return s;
		});
	}
	return _sectionsPromise;
}

// Sync fallback — only works after first load
export const SECTIONS: { prefix: string; slug: string; label: string }[] = new Proxy(
	[] as { prefix: string; slug: string; label: string }[],
	{
		get(_target, prop) {
			if (!_sectionsCache) {
				throw new Error("SECTIONS accessed before loadSections() was called. Use await loadSections() first.");
			}
			const value = _sectionsCache[prop as keyof typeof _sectionsCache];
			if (typeof value === "function") {
				return value.bind(_sectionsCache);
			}
			return value;
		},
	},
);

export interface S3Entry {
	key: string;
	slug: string;
	title: string;
	size: number;
	segments: string[];
}

// --- In-memory cache (TTL-based) ---
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const listCache = new Map<string, { data: S3Entry[]; pins: Set<string>; ts: number }>();

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
 * Parse XML response from S3 ListObjectsV2.
 * We do lightweight XML parsing since we can't use DOMParser in Workers
 * and don't want heavy dependencies.
 */
function parseListResponse(xml: string): {
	contents: { key: string; size: number }[];
	nextToken: string | null;
	isTruncated: boolean;
} {
	const contents: { key: string; size: number }[] = [];

	// Extract all <Contents> blocks
	const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
	let match;
	while ((match = contentsRegex.exec(xml)) !== null) {
		const block = match[1]!;
		const keyMatch = block.match(/<Key>(.*?)<\/Key>/);
		const sizeMatch = block.match(/<Size>(.*?)<\/Size>/);
		if (keyMatch) {
			contents.push({
				key: decodeXmlEntities(keyMatch[1]!),
				size: sizeMatch ? parseInt(sizeMatch[1]!, 10) : 0,
			});
		}
	}

	const truncMatch = xml.match(/<IsTruncated>(.*?)<\/IsTruncated>/);
	const isTruncated = truncMatch ? truncMatch[1] === "true" : false;

	const tokenMatch = xml.match(
		/<NextContinuationToken>(.*?)<\/NextContinuationToken>/,
	);
	const nextToken = tokenMatch ? decodeXmlEntities(tokenMatch[1]!) : null;

	return { contents, nextToken, isTruncated };
}

function decodeXmlEntities(str: string): string {
	return str
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
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
	const pins = new Set<string>();
	let continuationToken: string | null = null;

	do {
		// Build query string manually — URLSearchParams encodes spaces as '+'
		// but AWS Signature V4 requires '%20' encoding for signature to match.
		const paramParts = [
			`list-type=2`,
			`prefix=${encodeURIComponent(prefix)}`,
		];
		if (continuationToken) {
			paramParts.push(
				`continuation-token=${encodeURIComponent(continuationToken)}`,
			);
		}

		const url = `${ENDPOINT}/${BUCKET}?${paramParts.join("&")}`;
		const res = await s3.fetch(url);

		if (!res.ok) {
			throw new Error(
				`S3 ListObjectsV2 failed: ${res.status} ${await res.text()}`,
			);
		}

		const xml = await res.text();
		const parsed = parseListResponse(xml);

		for (const obj of parsed.contents) {
			const key = obj.key;

			// Track .pin files — the parent folder is "pinned"
			if (key.endsWith(".pin")) {
				// e.g. "2. Areas/english/.pin" → folder = "english"
				const rel = key.slice(prefix.length);
				const parts = rel.split("/").filter(Boolean);
				if (parts.length >= 2) {
					// Remove the ".pin" filename, keep the folder path
					pins.add(parts.slice(0, -1).join("/"));
				}
				continue;
			}

			if (!key.endsWith(".md") || key === prefix) continue;

			const rel = key.slice(prefix.length).replace(/\.md$/, "");
			entries.push({
				key,
				slug: slugify(key, prefix),
				title: titleFromFilename(key),
				size: obj.size,
				segments: rel.split("/").filter(Boolean),
			});
		}

		continuationToken = parsed.isTruncated ? parsed.nextToken : null;
	} while (continuationToken);

	listCache.set(prefix, { data: entries, pins, ts: Date.now() });
	return entries;
}

/**
 * List top-level folders under a prefix (uses delimiter, does not use cache).
 */
export async function listSectionFolders(prefix: string): Promise<{ folder: string; count: number }[]> {
	const folders = new Map<string, number>();
	let continuationToken: string | null = null;

	do {
		const paramParts = [`list-type=2`, `prefix=${encodeURIComponent(prefix)}`, `delimiter=/`];
		if (continuationToken) {
			paramParts.push(`continuation-token=${encodeURIComponent(continuationToken)}`);
		}

		const url = `${ENDPOINT}/${BUCKET}?${paramParts.join("&")}`;
		const res = await s3.fetch(url);

		if (!res.ok) {
			throw new Error(`S3 ListObjectsV2 failed: ${res.status} ${await res.text()}`);
		}

		const xml = await res.text();

		// Extract CommonPrefixes (folder entries)
		const prefixRegex = /<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g;
		let match;
		while ((match = prefixRegex.exec(xml)) !== null) {
			const keyMatch = match[1]!.match(/<Prefix>(.*?)<\/Prefix>/);
			if (keyMatch) {
				const folderPath = decodeXmlEntities(keyMatch[1]!);
				const rel = folderPath.slice(prefix.length);
				const parts = rel.split("/").filter(Boolean);
				if (parts.length > 0) {
					folders.set(parts[0]!, (folders.get(parts[0]!) ?? 0) + 1);
				}
			}
		}

		const tokenMatch = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/);
		continuationToken = tokenMatch ? decodeXmlEntities(tokenMatch[1]!) : null;
	} while (continuationToken);

	return Array.from(folders.entries()).map(([folder, count]) => ({ folder, count }));
}

/**
 * Fetch a single markdown file's content from S3.
 */
export async function fetchMarkdown(key: string): Promise<string> {
	const encodedKey = key
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	const url = `${ENDPOINT}/${BUCKET}/${encodedKey}`;
	const res = await s3.fetch(url);

	if (!res.ok) {
		throw new Error(
			`S3 GetObject failed for ${key}: ${res.status} ${await res.text()}`,
		);
	}

	return res.text();
}

/**
 * Create a .pin file in S3 to mark a folder as pinned.
 * @param sectionPrefix e.g. "2. Areas/"
 * @param folderPath relative folder path e.g. "english" or "sub/folder"
 */
export async function putPin(
	sectionPrefix: string,
	folderPath: string,
): Promise<void> {
	const key = `${sectionPrefix}${folderPath}/.pin`;
	const encodedKey = key
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	const url = `${ENDPOINT}/${BUCKET}/${encodedKey}`;
	const res = await s3.fetch(url, {
		method: "PUT",
		body: "",
	});

	if (!res.ok) {
		throw new Error(
			`S3 PutObject failed for ${key}: ${res.status} ${await res.text()}`,
		);
	}

	// Invalidate cache so next listing picks up the new pin
	invalidateCache(sectionPrefix);
}

/**
 * Delete a .pin file from S3 to unpin a folder.
 */
export async function deletePin(
	sectionPrefix: string,
	folderPath: string,
): Promise<void> {
	const key = `${sectionPrefix}${folderPath}/.pin`;
	const encodedKey = key
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	const url = `${ENDPOINT}/${BUCKET}/${encodedKey}`;
	const res = await s3.fetch(url, {
		method: "DELETE",
	});

	if (!res.ok && res.status !== 404) {
		throw new Error(
			`S3 DeleteObject failed for ${key}: ${res.status} ${await res.text()}`,
		);
	}

	invalidateCache(sectionPrefix);
}

/**
 * Invalidate the listing cache for a section so pin changes are reflected.
 */
export function invalidateCache(prefix: string): void {
	listCache.delete(prefix);
}

/**
 * Get the set of pinned folder paths for a section (from cache).
 * Call listSection() first to ensure cache is populated.
 */
export function getPinnedPaths(prefix: string): Set<string> {
	const cached = listCache.get(prefix);
	return cached?.pins ?? new Set();
}

export interface PinnedFolder {
	/** Display name of the folder */
	label: string;
	/** The section this folder belongs to */
	section: string;
	sectionSlug: string;
	/** Folder path relative to section (e.g. "english") */
	folderPath: string;
	/** Number of .md notes in this folder (recursive) */
	noteCount: number;
	/** Link to first note, or to the section listing */
	href: string;
}

/**
 * Get all pinned folders across all (or a specific) PARA section.
 * A folder is "pinned" if it contains a `.pin` file.
 */
export async function getPinnedFolders(
	sectionSlug?: string,
): Promise<PinnedFolder[]> {
	const sections = await loadSections();
	const targetSections = sectionSlug
		? sections.filter((s) => s.slug === sectionSlug)
		: sections;

	const results: PinnedFolder[] = [];

	for (const section of targetSections) {
		// Ensure listing is cached
		await listSection(section.prefix);
		const cached = listCache.get(section.prefix);
		if (!cached) continue;

		for (const pinPath of cached.pins) {
			// Count notes whose segments start with the pinned folder path
			const pinParts = pinPath.split("/");
			const notesInFolder = cached.data.filter((e) =>
				pinParts.every((part, i) => e.segments[i] === part),
			);

			// Slugify the folder path for a link
			const folderSlug = pinParts
				.map((s) =>
					s
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.replace(/^-|-$/g, ""),
				)
				.join("/");

			// Link to first note in folder, or section listing
			const firstNote = notesInFolder[0];
			const href = firstNote
				? `/${section.slug}/${firstNote.slug}`
				: `/${section.slug}`;

			results.push({
				label: pinParts[pinParts.length - 1]!,
				section: section.label,
				sectionSlug: section.slug,
				folderPath: pinPath,
				noteCount: notesInFolder.length,
				href,
			});
		}
	}

	return results;
}

/**
 * Given a section slug and page slug, find the matching S3 key.
 */
export async function resolveKey(
	sectionSlug: string,
	pageSlug: string,
): Promise<{ key: string; title: string } | null> {
	const sections = await loadSections();
	const section = sections.find((s) => s.slug === sectionSlug);
	if (!section) {
		throw new Error(
			`Section "${sectionSlug}" is not defined. ` +
				`Available sections: ${sections.map((s) => s.slug).join(", ")}. ` +
				`Check your SECTIONS env variable.`,
		);
	}

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

export function buildTree(
	entries: S3Entry[],
	sectionSlug: string,
): SidebarNode[] {
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
				let folder = current.find((n) => !n.slug && n.label === part);
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
