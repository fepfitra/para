import type { StoragePort } from "../../../../shared/domain/interfaces/ports";

export class ListSectionFolders {
	constructor(private storage: StoragePort) {}

	async execute(prefix: string): Promise<string[]> {
		const folders = await this.storage.listSectionFolders(prefix);
		return folders.map((f) => f.folder);
	}
}