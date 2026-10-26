// Vault path helpers (pure, no obsidian import). Vault paths use "/" and have no leading slash.

/** Folder of a vault path: "a/b/c.adoc" -> "a/b", "c.adoc" -> "". */
export function dirOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i);
}

/** File name without the folder. */
export function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** Extension in lower case without the dot, or "". */
export function extOf(path: string): string {
	const name = baseName(path);
	const i = name.lastIndexOf('.');
	return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** Replaces the extension of a path (or adds one). */
export function withExt(path: string, ext: string): string {
	const name = baseName(path);
	const i = name.lastIndexOf('.');
	const stem = i <= 0 ? path : path.slice(0, path.length - name.length + i);
	return `${stem}.${ext}`;
}

/**
 * Joins a target to a base folder and removes "." and ".." parts.
 * A target that starts with "/" is relative to the vault root. Returns null when ".." leaves the vault.
 */
export function joinPath(base: string, target: string): string | null {
	const parts = target.startsWith('/') ? [] : base.split('/').filter(Boolean);
	for (const part of target.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (parts.length === 0) return null;
			parts.pop();
		} else parts.push(part);
	}
	return parts.length ? parts.join('/') : null;
}

/** True for a target with a URL scheme (https:, mailto:, file:) rather than a vault path. */
export function isUrl(target: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target);
}

/** AsciiDoc file extensions this product opens. */
export const ADOC_EXTENSIONS = ['adoc', 'asciidoc'] as const;

export function isAdocPath(path: string): boolean {
	return (ADOC_EXTENSIONS as readonly string[]).includes(extOf(path));
}
