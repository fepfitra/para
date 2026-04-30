import type { APIRoute } from "astro";
import { S3StorageAdapter } from "../../../shared/infrastructure/s3/adapters";
import { SectionServiceAdapter } from "../../../shared/infrastructure/s3/adapters";
import { PinFolder, UnpinFolder } from "../../../pin/application/useCases";
import { wrapApiWithBadRequest } from "./api-utils";

const storage = new S3StorageAdapter();
const sectionService = new SectionServiceAdapter();

export const POST: APIRoute = async ({ request }) => {
	return wrapApiWithBadRequest(async () => {
		const { section, folderPath } = await request.json();
		if (!folderPath) throw new Error("Missing folderPath");
		const SECTIONS = await sectionService.loadSections();
		const sectionMeta = SECTIONS.find((s) => s.slug === section);
		if (!sectionMeta) throw new Error(`Section "${section}" not defined`);
		await new PinFolder(storage).execute(sectionMeta.prefix, folderPath);
		return { pinned: true };
	});
};

export const DELETE: APIRoute = async ({ request }) => {
	return wrapApiWithBadRequest(async () => {
		const { section, folderPath } = await request.json();
		if (!folderPath) throw new Error("Missing folderPath");
		const SECTIONS = await sectionService.loadSections();
		const sectionMeta = SECTIONS.find((s) => s.slug === section);
		if (!sectionMeta) throw new Error(`Section "${section}" not defined`);
		await new UnpinFolder(storage).execute(sectionMeta.prefix, folderPath);
		return { pinned: false };
	});
};