import type { StoragePort } from "../../../../shared/domain/interfaces/ports";

export class FetchNoteContent {
	constructor(private storage: StoragePort) {}

	async execute(key: string): Promise<string> {
		return this.storage.fetchMarkdown(key);
	}
}