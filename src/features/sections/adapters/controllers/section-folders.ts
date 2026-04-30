import type { APIRoute } from "astro";
import { S3StorageAdapter } from "../../../shared/infrastructure/s3/adapters";
import { ListSectionFolders } from "../../application/useCases";
import { wrapApi } from "../../../shared/adapters/controllers/api-utils";

const storage = new S3StorageAdapter();

export const GET: APIRoute = async () => {
	return wrapApi(async () => {
		return new ListSectionFolders(storage).execute("");
	});
};