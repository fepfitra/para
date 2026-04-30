import type { APIRoute } from "astro";
import { S3StorageAdapter } from "../../../shared/infrastructure/s3/adapters";
import { SectionServiceAdapter } from "../../../shared/infrastructure/s3/adapters";
import { wrapApiWithBadRequest } from "./api-utils";
import type { ParaConfig } from "../../../shared/domain/entities";

const storage = new S3StorageAdapter();
const sectionService = new SectionServiceAdapter();

export const GET: APIRoute = async () => {
	return wrapApiWithBadRequest(async () => {
		return storage.fetchConfig();
	});
};

export const PUT: APIRoute = async ({ request }) => {
	return wrapApiWithBadRequest(async () => {
		const body = (await request.json()) as { sections?: string[] };
		if (!body?.sections) throw new Error("Invalid config");
		const config: ParaConfig = { sections: body.sections };
		await storage.putConfig(config);
		sectionService.invalidateSectionsCache();
		return { ok: true };
	});
};