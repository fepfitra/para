import type { SectionServicePort } from "../../../../shared/domain/interfaces/ports";

export class GetPinnedPaths {
	constructor(private sectionService: SectionServicePort) {}

	execute(prefix: string): Set<string> {
		return this.sectionService.getPinnedPaths(prefix);
	}
}