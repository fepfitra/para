import type { Section, Note, PinnedFolder, ParaConfig, SidebarNode } from "../entities";

export interface StoragePort {
	fetchConfig(): Promise<ParaConfig | null>;
	putConfig(config: ParaConfig): Promise<void>;
	listSection(prefix: string): Promise<Note[]>;
	listSectionFolders(prefix: string): Promise<{ folder: string; count: number }[]>;
	fetchMarkdown(key: string): Promise<string>;
	putPin(sectionPrefix: string, folderPath: string): Promise<void>;
	deletePin(sectionPrefix: string, folderPath: string): Promise<void>;
	invalidateCache(prefix: string): void;
}

export interface CachePort {
	get<T>(key: string): T | null;
	set<T>(key: string, value: T, ttlMs: number): void;
	invalidate(key: string): void;
}

export interface SectionServicePort {
	loadSections(): Promise<Section[]>;
	invalidateSectionsCache(): void;
	getPinnedFolders(sectionSlug?: string): Promise<PinnedFolder[]>;
	getPinnedPaths(prefix: string): Set<string>;
	resolveKey(sectionSlug: string, pageSlug: string): Promise<{ key: string; title: string } | null>;
	buildTree(entries: Note[], sectionSlug: string): SidebarNode[];
}
