import type { StoragePort } from "../../../../shared/domain/interfaces/ports";

export class PinFolder {
	constructor(private storage: StoragePort) {}

	async execute(sectionPrefix: string, folderPath: string): Promise<void> {
		return this.storage.putPin(sectionPrefix, folderPath);
	}
}