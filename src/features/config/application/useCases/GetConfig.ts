import type { StoragePort } from "../../../../shared/domain/interfaces/ports";
import type { ParaConfig } from "../../../../shared/domain/entities";

export class GetConfig {
	constructor(private storage: StoragePort) {}

	async execute(): Promise<ParaConfig | null> {
		return this.storage.fetchConfig();
	}
}