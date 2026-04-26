import { loadSections, listSection } from "../../lib/s3";

export const GET: APIRoute = async ({ url }) => {
	const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();

	if (!query) {
		return new Response(JSON.stringify([]), {
			headers: { "Content-Type": "application/json" },
		});
	}

	const terms = query.split(/\s+/).filter(Boolean);

	const SECTIONS = await loadSections();
	const allEntries = await Promise.all(
		SECTIONS.map(async (section) => {
			const entries = await listSection(section.prefix);
			return entries.map((e) => ({
				title: e.title,
				slug: `/${section.slug}/${e.slug}`,
				section: section.label,
				path: e.segments.join("/"),
			}));
		}),
	);

	const flat = allEntries.flat();

	const results = flat.filter((entry) => {
		const haystack =
			`${entry.title} ${entry.path} ${entry.section}`.toLowerCase();
		return terms.every((term) => haystack.includes(term));
	});

	// Limit to 20 results
	return new Response(JSON.stringify(results.slice(0, 20)), {
		headers: { "Content-Type": "application/json" },
	});
};
