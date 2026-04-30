import type { Note } from "../../../../shared/domain/entities";
import type { StoragePort } from "../../../../shared/domain/interfaces/ports";

export class ListSectionNotes {
	constructor(private storage: StoragePort) {}

	async execute(prefix: string): Promise<Note[]> {
		return this.storage.listSection(prefix);
	}
}