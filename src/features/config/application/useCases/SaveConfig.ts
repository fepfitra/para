import type { StoragePort, SectionServicePort } from "../../../../shared/domain/interfaces/ports";
import type { ParaConfig } from "../../../../shared/domain/entities";

export class SaveConfig {
	constructor(
		private storage: StoragePort,
		private sectionService: SectionServicePort,
	) {}

	async execute(sections: string[]): Promise<void> {
		const config: ParaConfig = { sections };
		await this.storage.putConfig(config);
		this.sectionService.invalidateSectionsCache();
	}
}