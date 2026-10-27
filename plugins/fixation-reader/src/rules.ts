import type { FixationReaderSettings } from './settings';

/** Global and note switches take priority. Pro exclusions match folder boundaries and exact tags. Tag case does not matter, as in Obsidian. */
export function enabledFor(s: FixationReaderSettings, pro: boolean, path: string, tags: string[], frontmatter: unknown): boolean {
	if (!s.enabled || (frontmatter && typeof frontmatter === 'object' && 'fixation' in frontmatter && frontmatter.fixation === false)) return false;
	if (!pro) return true;
	const folders = s.excludedFolders.split('\n').map((v) => v.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
	if (folders.some((folder) => path.startsWith(`${folder}/`))) return false;
	const excluded = s.excludedTags.split(/[\n,]/).map((v) => v.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
	return !tags.some((tag) => excluded.includes(tag.replace(/^#/, '').toLowerCase()));
}
