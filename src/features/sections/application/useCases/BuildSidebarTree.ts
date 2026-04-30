import type { Note, SidebarNode } from "../../../../shared/domain/entities";
import type { SectionServicePort } from "../../../../shared/domain/interfaces/ports";

export class BuildSidebarTree {
	constructor(private sectionService: SectionServicePort) {}

	execute(entries: Note[], sectionSlug: string): SidebarNode[] {
		return this.sectionService.buildTree(entries, sectionSlug);
	}
}