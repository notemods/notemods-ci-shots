export interface ToggleResult {
	action: 'show' | 'hide' | 'empty';
	nextFilters: string[];
	savedFilters: string[] | null;
}

export interface PresetResult {
	nextFilters: string[];
	savedFilters: null;
}

export function parseFilterList(value: unknown): string[] | null {
	return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') ? value : null;
}

export function mergeFilters(...lists: string[][]): string[] {
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const list of lists) {
		for (const entry of list) {
			if (!seen.has(entry)) {
				seen.add(entry);
				merged.push(entry);
			}
		}
	}
	return merged;
}

export function toggleFilters(current: string[], saved: string[] | null): ToggleResult {
	if (saved !== null) {
		return { action: 'hide', nextFilters: mergeFilters(saved, current), savedFilters: null };
	}
	if (current.length === 0) return { action: 'empty', nextFilters: current, savedFilters: null };
	return { action: 'show', nextFilters: [], savedFilters: mergeFilters(current) };
}

export function restoreFilters(current: string[], saved: string[] | null): string[] | null {
	return saved === null ? null : mergeFilters(saved, current);
}

export function applyPresetFilters(presets: Record<string, string[]>, name: string): PresetResult | null {
	const filters = presets[name];
	return filters ? { nextFilters: mergeFilters(filters), savedFilters: null } : null;
}

export function runOp(op: { current: string[]; saved: string[] | null; restore?: boolean; preset?: Record<string, string[]>; name?: string; validate?: unknown }): unknown {
	if (op.validate !== undefined) return parseFilterList(op.validate);
	if (op.preset !== undefined && op.name !== undefined) return applyPresetFilters(op.preset, op.name);
	if (op.restore) return restoreFilters(op.current, op.saved);
	return toggleFilters(op.current, op.saved);
}
