import { MAX_BYTES } from './review';

export interface Baseline {
	path: string;
	text: string;
	ctime: number;
	invalid: boolean;
	name: string;
}
export interface RevisionSettings {
	baselineName: string;
	author: string;
	includeSummary: boolean;
}
export interface StoredState {
	version: 1;
	settings: RevisionSettings;
	session: Baseline | null;
	named: Baseline[];
}
export const DEFAULT_SETTINGS: RevisionSettings = { baselineName: 'First draft', author: '', includeSummary: false };

function baseline(value: unknown): Baseline | null {
	if (!value || typeof value !== 'object') return null;
	const v = value as Partial<Baseline>;
	if (typeof v.path !== 'string' || !v.path.endsWith('.md') || typeof v.text !== 'string' || typeof v.ctime !== 'number' || !Number.isFinite(v.ctime) || new TextEncoder().encode(v.text).length > MAX_BYTES) return null;
	return { path: v.path, text: v.text, ctime: v.ctime, invalid: v.invalid !== false, name: typeof v.name === 'string' ? v.name.slice(0, 80) : '' };
}
export function loadState(value: unknown): StoredState {
	const v = value && typeof value === 'object' ? value as Partial<StoredState> : {};
	const s = v.settings ?? DEFAULT_SETTINGS;
	return {
		version: 1,
		settings: {
			baselineName: typeof s.baselineName === 'string' ? s.baselineName.slice(0, 80) : DEFAULT_SETTINGS.baselineName,
			author: typeof s.author === 'string' ? s.author.slice(0, 80) : '',
			includeSummary: s.includeSummary === true,
		},
		session: baseline(v.session),
		named: Array.isArray(v.named) ? v.named.slice(0, 50).map(baseline).filter((b): b is Baseline => b !== null) : [],
	};
}
export function assertMatch(b: Baseline, file: { path: string; ctime: number } | null): void {
	if (!file || b.invalid || b.path !== file.path || b.ctime !== file.ctime) throw new Error('Baseline file does not match. Open the original note. Renamed or deleted baselines cannot be reassigned.');
}
export function folderOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? '' : path.slice(0, slash);
}
