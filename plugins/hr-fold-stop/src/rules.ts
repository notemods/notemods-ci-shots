// Pro rule wiring for Fold Stop. Folder path rules turn the boundary behavior on or off for a
// folder (the longest matching path wins). A note property overrides both folder rules.
// Pure functions; the Obsidian side reads the property through MetadataCache.getFileCache.
/** One saved folder rule. Longest matching `folder` path wins. */
export interface FolderRuleEntry {
	/** Vault path of the folder, for example "Archive" or "Archive/Active". */
	folder: string;
	/** true = use Fold Stop in this folder. false = normal Obsidian folding here. */
	enabled: boolean;
}

/**
 * The rule computed for one note: Fold Stop on or off for that file.
 * `source` says which setting won, for the effective-rule panel.
 */
export interface EffectiveRule {
	/** The vault toggle. Folder rules can turn Fold Stop off for a folder. */
	vaultEnabled: boolean;
	/** Folder rules from settings (Pro). Empty when not Pro or none saved. */
	folders: FolderRuleEntry[];
	/** The note property name that overrides a folder rule (Pro). Empty = no override allowed. */
	overrideProperty: string;
}

/** Result of `effectiveRuleForPath`. */
export interface RuleDecision {
	active: boolean;
	source: 'vault' | 'folder' | 'note';
	/** The folder rule that matched, or null when the vault toggle decided. */
	folder: FolderRuleEntry | null;
	/** The note property value that decided, or null. */
	noteValue: boolean | null;
}

function longestMatch(folders: FolderRuleEntry[], path: string): FolderRuleEntry | null {
	const lower = path;
	let best: FolderRuleEntry | null = null;
	for (const f of folders) {
		const folder = f.folder.trim().replace(/\/+$/, '');
		if (folder === '') continue; // empty folder matches nothing; the vault toggle is the global switch
		const prefix = folder + '/';
		if (lower === folder || lower.startsWith(prefix)) {
			if (best === null || f.folder.length > best.folder.length) best = f;
		}
	}
	return best;
}

/**
 * Decides whether Fold Stop folds for one note.
 * `noteProp` is the value of the override property for the note (true, false, or undefined).
 * A valid note value wins over both the folder rule and the vault toggle.
 */
export function effectiveRuleForPath(rule: EffectiveRule, path: string, noteProp?: boolean): RuleDecision {
	if (rule.overrideProperty && typeof noteProp === 'boolean') {
		return { active: noteProp, source: 'note', folder: longestMatch(rule.folders, path), noteValue: noteProp };
	}
	const folder = longestMatch(rule.folders, path);
	if (folder) return { active: folder.enabled, source: 'folder', folder, noteValue: null };
	return { active: rule.vaultEnabled, source: 'vault', folder: null, noteValue: null };
}

/** Keeps only valid entries, so hand-edited data.json cannot break the rule list. */
export function normalizeFolders(saved: unknown): FolderRuleEntry[] {
	if (!Array.isArray(saved)) return [];
	const out: FolderRuleEntry[] = [];
	for (const raw of saved) {
		if (!raw || typeof raw !== 'object') continue;
		if (typeof (raw as FolderRuleEntry).folder !== 'string') continue;
		const folder = (raw as FolderRuleEntry).folder.trim().replace(/\/+$/, '');
		if (folder === '') continue;
		if (typeof (raw as FolderRuleEntry).enabled !== 'boolean') continue;
		out.push({ folder, enabled: (raw as FolderRuleEntry).enabled });
	}
	return out;
}
