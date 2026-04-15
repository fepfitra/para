/**
 * Shared client-side logic for pin/unpin toggle buttons.
 * Imported by <script> tags in Sidebar.astro, [section]/index.astro, and index.astro.
 */

function callPinApi(method: string, section: string, folderPath: string) {
	return fetch("/api/pin", {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ section, folderPath }),
	}).then((res) => {
		if (!res.ok) throw new Error("Pin toggle failed");
		window.location.reload();
	});
}

/**
 * Bind click handlers to all `.pin-toggle` buttons (folder tree pin icons).
 * Uses stopPropagation so <details> collapse isn't triggered.
 * Shows confirm() before unpinning.
 */
export function initPinToggle() {
	document.querySelectorAll<HTMLButtonElement>(".pin-toggle").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();

			const section = btn.dataset.section!;
			const folder = btn.dataset.folder!;
			const isPinned = btn.dataset.pinned === "true";

			if (isPinned) {
				const label = folder.split("/").pop() || folder;
				if (!confirm(`Unpin "${label}"?`)) return;
			}

			const method = isPinned ? "DELETE" : "POST";

			// Optimistic UI: toggle icon fill
			const icon = btn.querySelector<SVGElement>(".pin-icon");
			if (icon) {
				icon.setAttribute("fill", isPinned ? "none" : "currentColor");
			}
			btn.dataset.pinned = isPinned ? "false" : "true";
			btn.title = isPinned ? "Pin folder" : "Unpin folder";

			callPinApi(method, section, folder).catch(() => {
				if (icon) {
					icon.setAttribute("fill", isPinned ? "currentColor" : "none");
				}
				btn.dataset.pinned = isPinned ? "true" : "false";
				btn.title = isPinned ? "Unpin folder" : "Pin folder";
			});
		});
	});
}

/**
 * Bind click handlers to all `.pinned-unpin` buttons (X buttons on pinned cards/list items).
 * Shows confirm() before unpinning. Fades the parent container optimistically.
 */
export function initPinnedUnpin() {
	document.querySelectorAll<HTMLButtonElement>(".pinned-unpin").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();

			const section = btn.dataset.section!;
			const folder = btn.dataset.folder!;
			const label = btn.dataset.label || folder.split("/").pop() || folder;

			if (!confirm(`Unpin "${label}"?`)) return;

			// Fade the closest container (li in sidebar, .group/pin card on pages)
			const container = (btn.closest("li") ?? btn.closest(".group\\/pin")) as HTMLElement | null;
			if (container) container.style.opacity = "0.4";

			callPinApi("DELETE", section, folder).catch(() => {
				if (container) container.style.opacity = "1";
			});
		});
	});
}
