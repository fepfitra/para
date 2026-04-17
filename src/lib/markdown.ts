import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import rehypeHighlight from "rehype-highlight";
import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";



function createProcessor() {
	return unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(rehypeRaw)
		.use(rehypeHighlight)
		.use(rehypeStringify);
}

const processor = createProcessor();

/**
 * Rewrite image URLs in HTML to point to the proxy endpoint.
 * Handles relative paths like ./image.jpg or ../folder/image.jpg
 */
function rewriteImageUrls(html: string, noteKey: string): string {
	// Get the directory of the note (e.g., "1. Projects/Sheen_QUB_UGM/")
	const noteDir = noteKey.split("/").slice(0, -1).join("/");
	if (!noteDir) return html;

	// Match img tags with src attribute (handles both single and double quotes)
	return html.replace(
		/<img\s+([^>]*)src=["']([^"']+)["']([^>]*)>/gi,
		(match, before, src, after) => {
			// Skip if already a proxy URL or data URL
			if (src.startsWith("/api/img/") || src.startsWith("data:")) {
				return match;
			}

			// Skip if it's an external URL (but rewrite if it's our S3 endpoint)
			if (src.startsWith("http://") || src.startsWith("https://")) {
				// If it's already an S3 URL, extract the path and proxy it
				try {
					const url = new URL(src);
					// Check if it's our S3 endpoint
					if (url.hostname.includes("s3.g.s4.mega.io")) {
						const path = url.pathname.replace(/^\//, "").replace(/^obsidian\//, "");
						const encodedPath = path
							.split("/")
							.map((segment: string) => encodeURIComponent(decodeURIComponent(segment)))
							.join("/");
						return `<img ${before}src="/api/img/${encodedPath}"${after}>`;
					}
				} catch {
					// Invalid URL, keep as is
				}
				return match;
			}

			// Resolve relative path
			let resolvedPath: string;
			if (src.startsWith("./")) {
				// ./image.jpg -> noteDir/image.jpg
				resolvedPath = `${noteDir}/${src.slice(2)}`;
			} else if (src.startsWith("../")) {
				// ../image.jpg -> go up one directory
				const parts = noteDir.split("/");
				parts.pop();
				resolvedPath = `${parts.join("/")}/${src.slice(3)}`;
			} else if (src.startsWith("/")) {
				// /image.jpg -> absolute from bucket root
				resolvedPath = src.slice(1);
			} else {
				// image.jpg -> relative to note directory
				resolvedPath = `${noteDir}/${src}`;
			}

			// URL encode the path components
			const encodedPath = resolvedPath
				.split("/")
				.map((segment: string) => encodeURIComponent(segment))
				.join("/");

			const newSrc = `/api/img/${encodedPath}`;
			// Use double quotes in output
			return `<img ${before}src="${newSrc}"${after}>`;
		}
	);
}

/**
 * Strip YAML frontmatter and return the markdown body.
 */
export function stripFrontmatter(raw: string): string {
	return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * Extract title from the first `# heading` in the body.
 */
export function extractTitle(body: string): string | null {
	const m = body.match(/^#\s+(.+)$/m);
	return m ? m[1].trim() : null;
}

export interface TocEntry {
	depth: number;
	text: string;
	id: string;
	subheadings: TocEntry[];
}

/**
 * Generate a slug for a heading text (for id attributes).
 */
function headingSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/<[^>]*>/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

/**
 * Inject id attributes into heading tags in HTML and extract TOC entries.
 * Returns a nested TOC structure matching fep-blog's format.
 */
export function extractToc(html: string): { html: string; toc: TocEntry[] } {
	const flat: TocEntry[] = [];
	const slugCounts = new Map<string, number>();

	const processed = html.replace(
		/<(h([2-4]))((?:\s[^>]*)?)>([\s\S]*?)<\/h\2>/gi,
		(_match, _tag, level, attrs, content) => {
			const text = content.replace(/<[^>]*>/g, "").trim();
			let slug = headingSlug(text);

			// Deduplicate slugs
			const count = slugCounts.get(slug) ?? 0;
			slugCounts.set(slug, count + 1);
			if (count > 0) slug = `${slug}-${count}`;

			const depth = parseInt(level, 10);
			flat.push({ depth, text, id: slug, subheadings: [] });

			return `<h${depth}${attrs} id="${slug}">${content}</h${depth}>`;
		},
	);

	// Build nested tree: h2 -> h3 -> h4
	const toc: TocEntry[] = [];
	const parentHeadings = new Map<number, TocEntry>();

	for (const h of flat) {
		const heading = { ...h, subheadings: [] };
		parentHeadings.set(heading.depth, heading);

		if (heading.depth === 2) {
			toc.push(heading);
		} else {
			const parent = parentHeadings.get(heading.depth - 1);
			if (parent) {
				parent.subheadings.push(heading);
			} else {
				toc.push(heading);
			}
		}
	}

	return { html: processed, toc };
}

/**
 * Render markdown string to HTML.
 * Legacy function - use renderMarkdownWithContext for notes with images.
 */
export async function renderMarkdown(raw: string): Promise<string> {
	const body = stripFrontmatter(raw);
	const result = await processor.process(body);
	return String(result);
}

/**
 * Render markdown with context for resolving relative image URLs.
 * @param raw - The raw markdown content
 * @param noteKey - The S3 key of the note (e.g., "1. Projects/Sheen_QUB_UGM/Meeting_Notes_2026-04-06.md")
 * @returns HTML with absolute image URLs pointing to S3
 */
export async function renderMarkdownWithContext(raw: string, noteKey: string): Promise<string> {
	const body = stripFrontmatter(raw);
	const result = await processor.process(body);
	const html = String(result);
	return rewriteImageUrls(html, noteKey);
}
