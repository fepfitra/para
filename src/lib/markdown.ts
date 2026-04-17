import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import rehypeHighlight from "rehype-highlight";

const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkRehype, { allowDangerousHtml: true })
	.use(rehypeRaw)
	.use(rehypeHighlight)
	.use(rehypeStringify);

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
 */
export async function renderMarkdown(raw: string): Promise<string> {
	const body = stripFrontmatter(raw);
	const result = await processor.process(body);
	return String(result);
}
