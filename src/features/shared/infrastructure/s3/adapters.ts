import { AwsClient } from "aws4fetch";
import type { Note, ParaConfig, SidebarNode, PinnedFolder } from "../../../shared/domain/entities";
import type { StoragePort, SectionServicePort } from "../../../shared/domain/interfaces/ports";

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
const CACHE_TTL = 5 * 60 * 1000;

function sectionFromPrefix(prefix: string): { prefix: string; slug: string; label: string } {
	const label = prefix.replace(/\/$/, "");
	return {
		prefix: prefix.endsWith("/") ? prefix : prefix + "/",
		slug: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
		label,
	};
}

function sectionsFromConfig(config: ParaConfig | null): { prefix: string; slug: string; label: string }[] | null {
	if (!config?.sections?.length) return null;
	const labels = config.sections.map((s: any) => typeof s === "string" ? s : s.label ?? s);
	return labels.map((label: string) => sectionFromPrefix(label));
}

function slugify(key: string, prefix: string): string {
	const rel = key.slice(prefix.length).replace(/\.md$/, "");
	return rel
		.split("/")
		.map((s) =>
			s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
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

function decodeXmlEntities(str: string): string {
	return str
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

function parseListResponse(xml: string): {
	contents: { key: string; size: number }[];
	nextToken: string | null;
	isTruncated: boolean;
} {
	const contents: { key: string; size: number }[] = [];
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
	const tokenMatch = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/);
	const nextToken = tokenMatch ? decodeXmlEntities(tokenMatch[1]!) : null;
	return { contents, nextToken, isTruncated };
}

const listCache = new Map<string, { data: Note[]; pins: Set<string>; ts: number }>();
let _sectionsPromise: Promise<{ prefix: string; slug: string; label: string }[]> | null = null;
let _sectionsCache: { prefix: string; slug: string; label: string }[] | null = null;

export class S3StorageAdapter implements StoragePort {
	async fetchConfig(): Promise<ParaConfig | null> {
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

	async putConfig(config: ParaConfig): Promise<void> {
		const encodedKey = CONFIG_KEY.split("/").map((s) => encodeURIComponent(s)).join("/");
		const url = `${ENDPOINT}/${BUCKET}/${encodedKey}`;
		const body = JSON.stringify(config, null, 2);
		const res = await s3.fetch(url, { method: "PUT", body, headers: { "Content-Type": "application/json" } });
		if (!res.ok) throw new Error(`Failed to save ${CONFIG_KEY}: ${res.status} ${await res.text()}`);
	}

	async listSection(prefix: string): Promise<Note[]> {
		const cached = listCache.get(prefix);
		if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

		const entries: Note[] = [];
		const pins = new Set<string>();
		let continuationToken: string | null = null;

		do {
			const paramParts = [`list-type=2`, `prefix=${encodeURIComponent(prefix)}`];
			if (continuationToken) paramParts.push(`continuation-token=${encodeURIComponent(continuationToken)}`);
			const url = `${ENDPOINT}/${BUCKET}?${paramParts.join("&")}`;
			const res = await s3.fetch(url);
			if (!res.ok) throw new Error(`S3 ListObjectsV2 failed: ${res.status} ${await res.text()}`);

			const xml = await res.text();
			const parsed = parseListResponse(xml);

			for (const obj of parsed.contents) {
				const key = obj.key;
				const isPinnedFile = key.endsWith(".pinned.md");
				const isPinSentinel = key.endsWith("/.pin");

				if (isPinnedFile) {
					const rel = key.slice(prefix.length);
					const parts = rel.split("/").filter(Boolean);
					if (parts.length >= 1) pins.add(parts.slice(0, -1).join("/"));
				} else if (isPinSentinel) {
					const rel = key.slice(prefix.length);
					const parts = rel.split("/").filter(Boolean);
					if (parts.length >= 1) pins.add(parts.slice(0, -1).join("/"));
				}

				if (key.endsWith(".md") && !isPinnedFile) {
					const pinnedKey = key.replace(/\.md$/, ".pinned.md");
					if (parsed.contents.some(c => c.key === pinnedKey)) continue;
				}

				if (!key.endsWith(".md") || key === prefix) continue;

				const rel = key.slice(prefix.length).replace(/\.pinned\.md$/, "").replace(/\.md$/, "");
				entries.push({
					key,
					slug: slugify(key, prefix),
					title: titleFromFilename(key),
					size: obj.size,
					segments: rel.split("/").filter(Boolean),
					pinned: isPinnedFile,
				});
			}
			continuationToken = parsed.isTruncated ? parsed.nextToken : null;
		} while (continuationToken);

		listCache.set(prefix, { data: entries, pins, ts: Date.now() });
		return entries;
	}

	async listSectionFolders(prefix: string): Promise<{ folder: string; count: number }[]> {
		const folders = new Map<string, number>();
		let continuationToken: string | null = null;

		do {
			const paramParts = [`list-type=2`, `prefix=${encodeURIComponent(prefix)}`, `delimiter=/`];
			if (continuationToken) paramParts.push(`continuation-token=${encodeURIComponent(continuationToken)}`);
			const url = `${ENDPOINT}/${BUCKET}?${paramParts.join("&")}`;
			const res = await s3.fetch(url);
			if (!res.ok) throw new Error(`S3 ListObjectsV2 failed: ${res.status} ${await res.text()}`);

			const xml = await res.text();
			const prefixRegex = /<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g;
			let match;
			while ((match = prefixRegex.exec(xml)) !== null) {
				const keyMatch = match[1]!.match(/<Prefix>(.*?)<\/Prefix>/);
				if (keyMatch) {
					const folderPath = decodeXmlEntities(keyMatch[1]!);
					const rel = folderPath.slice(prefix.length);
					const parts = rel.split("/").filter(Boolean);
					if (parts.length > 0) folders.set(parts[0]!, (folders.get(parts[0]!) ?? 0) + 1);
				}
			}
			const tokenMatch = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/);
			continuationToken = tokenMatch ? decodeXmlEntities(tokenMatch[1]!) : null;
		} while (continuationToken);

		return Array.from(folders.entries()).map(([folder, count]) => ({ folder, count }));
	}

	async fetchMarkdown(key: string): Promise<string> {
		const encodedKey = key.split("/").map((s) => encodeURIComponent(s)).join("/");
		const url = `${ENDPOINT}/${BUCKET}/${encodedKey}`;
		const res = await s3.fetch(url);
		if (!res.ok) throw new Error(`S3 GetObject failed for ${key}: ${res.status} ${await res.text()}`);
		return res.text();
	}

	async putPin(sectionPrefix: string, folderPath: string): Promise<void> {
		const key = `${sectionPrefix}${folderPath}/.pin`;
		const encodedKey = key.split("/").map((s) => encodeURIComponent(s)).join("/");
		const url = `${ENDPOINT}/${BUCKET}/${encodedKey}`;
		const res = await s3.fetch(url, { method: "PUT", body: "" });
		if (!res.ok) throw new Error(`S3 PutObject failed: ${res.status}`);
		this.invalidateCache(sectionPrefix);
	}

	async deletePin(sectionPrefix: string, folderPath: string): Promise<void> {
		const key = `${sectionPrefix}${folderPath}/.pin`;
		const encodedKey = key.split("/").map((s) => encodeURIComponent(s)).join("/");
		const url = `${ENDPOINT}/${BUCKET}/${encodedKey}`;
		const res = await s3.fetch(url, { method: "DELETE" });
		if (!res.ok && res.status !== 404) throw new Error(`S3 DeleteObject failed: ${res.status}`);
		this.invalidateCache(sectionPrefix);
	}

	invalidateCache(prefix: string): void {
		listCache.delete(prefix);
	}
}

export class SectionServiceAdapter implements SectionServicePort {
	async loadSections(): Promise<{ prefix: string; slug: string; label: string }[]> {
		if (_sectionsCache) return _sectionsCache;
		if (!_sectionsPromise) {
			_sectionsPromise = this.doLoadSections().then((s) => {
				_sectionsCache = s;
				return s;
			});
		}
		return _sectionsPromise;
	}

	private async doLoadSections(): Promise<{ prefix: string; slug: string; label: string }[]> {
		try {
			const config = await this.fetchConfig();
			const sections = sectionsFromConfig(config);
			if (sections) return sections;
		} catch { /* ignore */ }
		return [];
	}

	private async fetchConfig(): Promise<ParaConfig | null> {
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

	async getPinnedFolders(sectionSlug?: string): Promise<PinnedFolder[]> {
		const sections = await this.loadSections();
		const targetSections = sectionSlug ? sections.filter((s) => s.slug === sectionSlug) : sections;
		const results: PinnedFolder[] = [];

		for (const section of targetSections) {
			const cached = listCache.get(section.prefix);
			if (!cached) continue;

			for (const pinPath of cached.pins) {
				const pinParts = pinPath.split("/");
				const notesInFolder = cached.data.filter((e) =>
					pinParts.every((part, i) => e.segments[i] === part),
				);

				const folderSlug = pinParts
					.map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
					.join("/");

				const firstNote = notesInFolder[0];
				const href = firstNote ? `/${section.slug}/${firstNote.slug}` : `/${section.slug}`;

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

	async resolveKey(sectionSlug: string, pageSlug: string): Promise<{ key: string; title: string } | null> {
		const sections = await this.loadSections();
		const section = sections.find((s) => s.slug === sectionSlug);
		if (!section) throw new Error(`Section "${sectionSlug}" not defined`);
		const storage = new S3StorageAdapter();
		const entries = await storage.listSection(section.prefix);
		const entry = entries.find((e) => e.slug === pageSlug);
		return entry ? { key: entry.key, title: entry.title } : null;
	}

	invalidateSectionsCache(): void {
		_sectionsCache = null;
		_sectionsPromise = null;
	}

	getPinnedPaths(prefix: string): Set<string> {
		const cached = listCache.get(prefix);
		return cached?.pins ?? new Set();
	}

	buildTree(entries: Note[], sectionSlug: string): SidebarNode[] {
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
						key: entry.key,
						pinned: entry.pinned,
						children: [],
					});
				} else {
					let folder = current.find((n) => !n.slug && n.label === part);
					if (!folder) folder = { label: part, children: [] };
					current.push(folder);
					current = folder.children;
				}
			}
		}
		return root;
	}
}