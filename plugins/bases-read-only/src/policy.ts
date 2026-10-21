import { normalizePath } from 'obsidian';

export interface LockSettings {
	locked: string[];
	rules: string[];
	editable: string[];
	kiosk: boolean;
}

const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))] : [];
export function normalizeSettings(value: unknown): LockSettings {
	const s = (value && typeof value === 'object' ? value : {}) as Partial<LockSettings>;
	return {
		locked: [...new Set(strings(s.locked).map(normalizePath).filter((p) => p.endsWith('.base')))],
		rules: strings(s.rules).map(normalizePath),
		editable: strings(s.editable).map((p) => p.startsWith('note.') ? p.slice(5) : p),
		kiosk: s.kiosk === true,
	};
}

/** Supported glob tokens: * within a folder, ** across folders, and ? for one character. */
export function matchesRule(path: string, rule: string): boolean {
	if (!path.endsWith('.base') || !rule) return false;
	let pattern = normalizePath(rule);
	if (!/[?*]/.test(pattern) && !pattern.endsWith('.base')) pattern += '/**';
	let rx = '^';
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i]!;
		if (ch === '*' && pattern[i + 1] === '*') {
			i++;
			if (pattern[i + 1] === '/') { i++; rx += '(?:.*/)?'; }
			else rx += '.*';
		} else if (ch === '*') rx += '[^/]*';
		else if (ch === '?') rx += '[^/]';
		else rx += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(rx + '$').test(normalizePath(path));
}

export function isLocked(s: LockSettings, path: string, pro: boolean): boolean {
	return path.endsWith('.base') && (s.locked.includes(path) || (pro && (s.kiosk || s.rules.some((rule) => matchesRule(path, rule)))));
}
export function toggleLocked(s: LockSettings, path: string): LockSettings {
	if (!path.endsWith('.base')) return s;
	return { ...s, locked: s.locked.includes(path) ? s.locked.filter((p) => p !== path) : [...s.locked, path] };
}
const under = (p: string, path: string) => p === path || p.startsWith(path + '/');
/** Returns the same object when no lock moves, so the caller can skip the save. */
export function renameLocked(s: LockSettings, oldPath: string, newPath: string): LockSettings {
	if (!s.locked.some((p) => under(p, oldPath))) return s;
	return { ...s, locked: [...new Set(s.locked.map((p) => under(p, oldPath) ? newPath + p.slice(oldPath.length) : p))].filter((p) => p.endsWith('.base')) };
}
/** Removes the lock of a deleted base, or of each base below a deleted folder. */
export function removeLocked(s: LockSettings, path: string): LockSettings {
	return s.locked.some((p) => under(p, path)) ? { ...s, locked: s.locked.filter((p) => !under(p, path)) } : s;
}

export interface EditAttempt {
	type: string;
	zone: 'cell' | 'drag' | 'toolbar' | 'switch' | 'link' | 'background';
	key?: string;
	ctrl?: boolean;
	meta?: boolean;
	alt?: boolean;
	button?: number;
	property?: string;
	/** The target is a number, date or time input. Arrow keys change its value. */
	stepper?: boolean;
}

/** The event policy has no side effects. The DOM adapter supplies the zone and property. */
export function shouldBlock(s: LockSettings, path: string, pro: boolean, e: EditAttempt): boolean {
	if (!isLocked(s, path, pro) || e.zone === 'switch' || e.zone === 'background') return false;
	if (e.type === 'dragstart' || e.type === 'drop') return true;
	if (e.zone === 'link' && ['click', 'mousedown', 'pointerdown', 'touchstart'].includes(e.type)) return false;
	if (e.zone === 'link' && e.type === 'keydown' && ['Enter', ' '].includes(e.key ?? '')) return false;
	if (e.zone === 'toolbar') return true;
	if (e.zone === 'drag' && (e.type === 'pointerdown' || e.type === 'mousedown' || e.type === 'touchstart')) return true;
	if (pro && e.property && s.editable.includes(e.property.replace(/^note\./, ''))) return false;
	if (e.type === 'keydown') {
		const key = e.key ?? '';
		if (e.stepper && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(key)) return true;
		if (e.ctrl || e.meta) return ['v', 'x', 'z', 'y', 'Enter', 'Backspace', 'Delete'].includes(key.length === 1 ? key.toLowerCase() : key);
		if (e.alt) return false;
		return key.length === 1 || ['Enter', 'Backspace', 'Delete', 'F2'].includes(key);
	}
	return ['click', 'dblclick', 'beforeinput', 'paste', 'cut', 'contextmenu'].includes(e.type);
}
