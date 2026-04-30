import type { SectionServicePort } from "../../../../shared/domain/interfaces/ports";

export class ResolveNoteKey {
	constructor(private sectionService: SectionServicePort) {}

	async execute(sectionSlug: string, pageSlug: string): Promise<{ key: string; title: string } | null> {
		return this.sectionService.resolveKey(sectionSlug, pageSlug);
	}
}