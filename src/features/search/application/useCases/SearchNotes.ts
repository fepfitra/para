import type { StoragePort, SectionServicePort } from "../../../../shared/domain/interfaces/ports";

export interface SearchResult {
	title: string;
	slug: string;
	section: string;
	path: string;
}

export class SearchNotes {
	constructor(
		private storage: StoragePort,
		private sectionService: SectionServicePort,
	) {}

	async execute(query: string, maxResults = 20): Promise<SearchResult[]> {
		const trimmedQuery = query.trim().toLowerCase();
		if (!trimmedQuery) return [];

		const terms = trimmedQuery.split(/\s+/).filter(Boolean);
		const sections = await this.sectionService.loadSections();

		const allEntries = await Promise.all(
			sections.map(async (section) => {
				const entries = await this.storage.listSection(section.prefix);
				return entries.map((e) => ({
					title: e.title,
					slug: `/${section.slug}/${e.slug}`,
					section: section.label,
					path: e.segments.join("/"),
				}));
			}),
		);

		const flat = allEntries.flat();
		return flat
			.filter((entry) => {
				const haystack = `${entry.title} ${entry.path} ${entry.section}`.toLowerCase();
				return terms.every((term) => haystack.includes(term));
			})
			.slice(0, maxResults);
	}
}