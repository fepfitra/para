import type { APIRoute } from "astro";
import { S3StorageAdapter, SectionServiceAdapter } from "../../../shared/infrastructure/s3/adapters";
import { GetConfig, SaveConfig } from "../../application/useCases";
import { wrapApiWithBadRequest } from "../../../shared/adapters/controllers/api-utils";

const storage = new S3StorageAdapter();
const sectionService = new SectionServiceAdapter();

export const GET: APIRoute = async () => {
	return wrapApiWithBadRequest(async () => {
		return new GetConfig(storage).execute();
	});
};

export const PUT: APIRoute = async ({ request }) => {
	return wrapApiWithBadRequest(async () => {
		const body = (await request.json()) as { sections?: string[] };
		if (!body?.sections) throw new Error("Invalid config");
		await new SaveConfig(storage, sectionService).execute(body.sections);
		return { ok: true };
	});
};