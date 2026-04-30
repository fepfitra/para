import type { StoragePort } from "../../../../shared/domain/interfaces/ports";

export class UnpinFolder {
	constructor(private storage: StoragePort) {}

	async execute(sectionPrefix: string, folderPath: string): Promise<void> {
		return this.storage.deletePin(sectionPrefix, folderPath);
	}
}