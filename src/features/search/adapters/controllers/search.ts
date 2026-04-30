import type { APIRoute } from "astro";
import { S3StorageAdapter, SectionServiceAdapter } from "../../../shared/infrastructure/s3/adapters";
import { SearchNotes } from "../../application/useCases";
import { wrapApi } from "../../../shared/adapters/controllers/api-utils";

const storage = new S3StorageAdapter();
const sectionService = new SectionServiceAdapter();
const searchNotes = new SearchNotes(storage, sectionService);

export const GET: APIRoute = async ({ url }) => {
	return wrapApi(async () => {
		const query = url.searchParams.get("q") ?? "";
		return searchNotes.execute(query);
	});
};