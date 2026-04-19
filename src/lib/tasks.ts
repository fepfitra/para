import { AwsClient } from "aws4fetch";

const s3 = new AwsClient({
	accessKeyId: import.meta.env.S3_ACCESS_KEY,
	secretAccessKey: import.meta.env.S3_SECRET_KEY,
	region: import.meta.env.S3_REGION || "eu-central-1",
	service: "s3",
});

const ENDPOINT = import.meta.env.S3_ENDPOINT || "https://s3.g.s4.mega.io";
const BUCKET = import.meta.env.S3_BUCKET || "obsidian";

// Tasks configuration from env
// If TASKS_PREFIX is not set or empty, tasks feature is disabled
const TASKS_PREFIX_RAW = import.meta.env.TASKS_PREFIX;
export const TASKS_ENABLED = Boolean(TASKS_PREFIX_RAW);
const TASKS_PREFIX = TASKS_ENABLED ? TASKS_PREFIX_RAW : "TaskNotes/Tasks/";

// Tags that mark a file as a task (default: ["task"])
const TASK_TAGS = (import.meta.env.TASK_TAGS || "task").split(",").map((t: string) => t.trim());
// Tags that exclude a file from active tasks (default: ["archived"])
const EXCLUDED_TAGS = (import.meta.env.TASK_EXCLUDED_TAGS || "archived").split(",").map((t: string) => t.trim());
// Statuses to exclude from active tasks (default: done)
const EXCLUDED_STATUSES = (import.meta.env.TASK_EXCLUDED_STATUSES || "done").split(",").map((s: string) => s.trim());

// --- Types ---

export interface Task {
	/** S3 key */
	key: string;
	/** URL slug derived from filename */
	slug: string;
	/** Display title (frontmatter title → first # heading → filename) */
	title: string;
	status: "todo" | "in-progress" | "done";
	priority: "none" | "low" | "normal" | "high";
	tags: string[];
	dateCreated?: string;
	dateModified?: string;
	due?: string;
	scheduled?: string;
	completedDate?: string;
	/** Computed urgency score for sorting (higher = more urgent) */
	urgencyScore: number;
}

// --- Cache ---

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let taskCache: { data: Task[]; ts: number } | null = null;

// --- Frontmatter parsing ---

/**
 * Parse YAML frontmatter from a markdown string.
 * Lightweight parser — handles the fields we care about.
 */
function parseFrontmatter(raw: string): Record<string, unknown> {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};

	const yaml = match[1]!;
	const result: Record<string, unknown> = {};

	let currentKey = "";
	let inArray = false;
	let arrayValues: string[] = [];

	for (const line of yaml.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		// Array item (indented "- value")
		if (inArray && /^\s*-\s+/.test(line)) {
			const val = trimmed.replace(/^-\s+/, "").replace(/^["']|["']$/g, "");
			arrayValues.push(val);
			continue;
		}

		// If we were collecting array items, save them
		if (inArray) {
			result[currentKey] = arrayValues;
			inArray = false;
			arrayValues = [];
		}

		// Key: value pair
		const kvMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)/);
		if (!kvMatch) continue;

		const key = kvMatch[1]!;
		let value = kvMatch[2]!.trim();

		// Inline array: [a, b, c]
		if (value.startsWith("[") && value.endsWith("]")) {
			const inner = value.slice(1, -1);
			result[key] = inner
				.split(",")
				.map((s) => s.trim().replace(/^["']|["']$/g, ""))
				.filter(Boolean);
			continue;
		}

		// Empty value — might be start of a multi-line array
		if (value === "" || value === "[]") {
			currentKey = key;
			inArray = true;
			arrayValues = [];
			if (value === "[]") {
				result[key] = [];
				inArray = false;
			}
			continue;
		}

		// Remove quotes
		value = value.replace(/^["']|["']$/g, "");

		result[key] = value;
	}

	// Flush last array if still collecting
	if (inArray) {
		result[currentKey] = arrayValues;
	}

	return result;
}

/**
 * Extract title from markdown body (first # heading) or from filename.
 */
function extractTitle(raw: string, key: string): string {
	// Strip frontmatter
	const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
	const headingMatch = body.match(/^#\s+(.+)$/m);
	if (headingMatch) return headingMatch[1]!.trim();

	// Fall back to filename
	const filename = key.split("/").pop()!;
	return filename
		.replace(/\.md$/, "")
		.replace(/[_-]+/g, " ")
		.replace(/(?:^|\s)\w/g, (c) => c.toUpperCase());
}

// --- Urgency scoring ---

const PRIORITY_WEIGHTS: Record<string, number> = {
	none: 0,
	low: 1,
	normal: 2,
	high: 3,
};

/**
 * Derive a URL-safe slug from an S3 key.
 * e.g. "TaskNotes/Tasks/Gym_Tasks.md" → "gym-tasks"
 */
function slugFromKey(key: string): string {
	const filename = key.split("/").pop()!;
	return filename
		.replace(/\.md$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function computeUrgency(
	priority: string,
	due?: string,
	scheduled?: string,
): number {
	const pw = PRIORITY_WEIGHTS[priority] ?? 0;

	const now = new Date();
	now.setHours(0, 0, 0, 0);

	let dateScore = 0;
	const targetDate = due || scheduled;
	if (targetDate) {
		const target = new Date(targetDate);
		target.setHours(0, 0, 0, 0);
		const daysUntil =
			(target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

		// Overdue tasks get a big boost; closer tasks get higher scores
		if (daysUntil < 0) {
			dateScore = 10 + Math.abs(daysUntil); // overdue: higher the longer overdue
		} else if (daysUntil <= 7) {
			dateScore = 7 - daysUntil; // this week: 0-7 points
		}
		// Beyond 7 days: no date score boost
	}

	return pw + dateScore;
}

// --- S3 listing ---

function parseListResponse(xml: string): {
	contents: { key: string; size: number }[];
	nextToken: string | null;
	isTruncated: boolean;
} {
	const contents: { key: string; size: number }[] = [];

	const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
	let match;
	while ((match = contentsRegex.exec(xml)) !== null) {
		const block = match[1]!;
		const keyMatch = block.match(/<Key>(.*?)<\/Key>/);
		const sizeMatch = block.match(/<Size>(.*?)<\/Size>/);
		if (keyMatch) {
			contents.push({
				key: decodeXmlEntities(keyMatch[1]!),
				size: sizeMatch ? parseInt(sizeMatch[1]!, 10) : 0,
			});
		}
	}

	const truncMatch = xml.match(/<IsTruncated>(.*?)<\/IsTruncated>/);
	const isTruncated = truncMatch ? truncMatch[1] === "true" : false;

	const tokenMatch = xml.match(
		/<NextContinuationToken>(.*?)<\/NextContinuationToken>/,
	);
	const nextToken = tokenMatch ? decodeXmlEntities(tokenMatch[1]!) : null;

	return { contents, nextToken, isTruncated };
}

function decodeXmlEntities(str: string): string {
	return str
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

async function listTaskKeys(): Promise<string[]> {
	const keys: string[] = [];
	let continuationToken: string | null = null;

	do {
		const paramParts = [
			`list-type=2`,
			`prefix=${encodeURIComponent(TASKS_PREFIX)}`,
		];
		if (continuationToken) {
			paramParts.push(
				`continuation-token=${encodeURIComponent(continuationToken)}`,
			);
		}

		const url = `${ENDPOINT}/${BUCKET}?${paramParts.join("&")}`;
		const res = await s3.fetch(url);

		if (!res.ok) {
			throw new Error(
				`S3 ListObjectsV2 failed for tasks: ${res.status} ${await res.text()}`,
			);
		}

		const xml = await res.text();
		const parsed = parseListResponse(xml);

		for (const obj of parsed.contents) {
			if (obj.key.endsWith(".md")) {
				keys.push(obj.key);
			}
		}

		continuationToken = parsed.isTruncated ? parsed.nextToken : null;
	} while (continuationToken);

	return keys;
}

async function fetchTaskFile(key: string): Promise<string> {
	const encodedKey = key
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	const url = `${ENDPOINT}/${BUCKET}/${encodedKey}`;
	const res = await s3.fetch(url);

	if (!res.ok) {
		throw new Error(
			`S3 GetObject failed for ${key}: ${res.status} ${await res.text()}`,
		);
	}

	return res.text();
}

// --- Public API ---

/**
 * Get all active tasks, sorted by urgency (most urgent first).
 * Active = has all TASK_TAGS AND does NOT have any EXCLUDED_TAGS AND status not in EXCLUDED_STATUSES.
 * Cached for 5 minutes.
 */
export async function getActiveTasks(): Promise<Task[]> {
	if (taskCache && Date.now() - taskCache.ts < CACHE_TTL) {
		return taskCache.data;
	}

	const keys = await listTaskKeys();

	// Fetch all task files in parallel
	const results = await Promise.allSettled(
		keys.map(async (key) => {
			const raw = await fetchTaskFile(key);
			const fm = parseFrontmatter(raw);

			const tags: string[] = Array.isArray(fm.tags)
				? (fm.tags as string[])
				: typeof fm.tags === "string"
					? [fm.tags]
					: [];

			// Active filter: must have all required tags, no excluded tags
			const hasAllRequiredTags = TASK_TAGS.every((tag: string) => tags.includes(tag));
			if (!hasAllRequiredTags) return null;

			const hasExcludedTag = EXCLUDED_TAGS.some((tag: string) => tags.includes(tag));
			if (hasExcludedTag) return null;

			const status = (fm.status as string) || "todo";
			if (EXCLUDED_STATUSES.includes(status)) return null;

			const priority = (fm.priority as string) || "none";
			const due = fm.due as string | undefined;
			const scheduled = fm.scheduled as string | undefined;

			const title =
				typeof fm.title === "string" && fm.title
					? fm.title
					: extractTitle(raw, key);

			const task: Task = {
				key,
				slug: slugFromKey(key),
				title,
				status: status as Task["status"],
				priority: priority as Task["priority"],
				tags,
				dateCreated: fm.dateCreated as string | undefined,
				dateModified: fm.dateModified as string | undefined,
				due,
				scheduled,
				completedDate: fm.completedDate as string | undefined,
				urgencyScore: computeUrgency(priority, due, scheduled),
			};

			return task;
		}),
	);

	const tasks: Task[] = [];
	for (const r of results) {
		if (r.status === "fulfilled" && r.value) {
			tasks.push(r.value);
		}
	}

	// Sort by urgency descending (most urgent first)
	tasks.sort((a, b) => b.urgencyScore - a.urgencyScore);

	taskCache = { data: tasks, ts: Date.now() };
	return tasks;
}

/**
 * Find a task by its slug. Returns null if not found.
 */
export async function resolveTask(slug: string): Promise<Task | null> {
	const tasks = await getActiveTasks();
	return tasks.find((t) => t.slug === slug) ?? null;
}

/**
 * Fetch the raw markdown content of a task file from S3.
 */
export async function fetchTaskContent(key: string): Promise<string> {
	return fetchTaskFile(key);
}
