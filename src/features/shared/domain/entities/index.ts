export interface Section {
	prefix: string;
	slug: string;
	label: string;
}

export interface Note {
	key: string;
	slug: string;
	title: string;
	size: number;
	segments: string[];
	pinned: boolean;
}

export interface PinnedFolder {
	label: string;
	section: string;
	sectionSlug: string;
	folderPath: string;
	noteCount: number;
	href: string;
}

export interface SidebarNode {
	label: string;
	slug?: string;
	key?: string;
	pinned?: boolean;
	children: SidebarNode[];
}

export interface ParaConfig {
	sections: string[];
}
