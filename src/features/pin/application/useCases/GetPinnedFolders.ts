import type { StoragePort, SectionServicePort } from "../../../../shared/domain/interfaces/ports";
import type { PinnedFolder } from "../../../../shared/domain/entities";

export class GetPinnedFolders {
	constructor(
		private storage: StoragePort,
		private sectionService: SectionServicePort,
	) {}

	async execute(sectionSlug?: string): Promise<PinnedFolder[]> {
		return this.sectionService.getPinnedFolders(sectionSlug);
	}
}