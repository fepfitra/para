import type { SectionServicePort, Section } from "../../../../shared/domain/interfaces/ports";

export class GetSections {
	constructor(private sectionService: SectionServicePort) {}

	async execute(): Promise<Section[]> {
		return this.sectionService.loadSections();
	}
}