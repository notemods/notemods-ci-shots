import { FIELDS, LABELS, cleanLabel, type Labels } from './fields';

export interface Display { labels: Labels; compact: boolean }
export interface Settings {
	enabled: boolean;
	labels: Labels;
	compact: boolean;
	presetName: string;
	selectedPreset: string;
	presets: Record<string, Display>;
	folderRules: string;
}
export const MAX_PRESETS = 30;
export const DEFAULT_SETTINGS: Settings = { enabled: true, labels: { ...LABELS }, compact: false, presetName: '', selectedPreset: '', presets: {}, folderRules: '' };
const hasOwn = (v: object, key: string): boolean => Object.prototype.hasOwnProperty.call(v, key);
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function labels(v: unknown): Labels {
	const result = { ...LABELS };
	for (const f of FIELDS) result[f] = cleanLabel(record(v) ? v[f] : undefined, LABELS[f]);
	return result;
}
export function normalizeSettings(v: unknown): Settings {
	const s = record(v) ? v : {};
	const presets: Record<string, Display> = {};
	if (record(s.presets)) {
		for (const [name, value] of Object.entries(s.presets).slice(0, MAX_PRESETS)) {
			if (!name.trim() || name.length > 40 || ['__proto__', 'constructor', 'prototype'].includes(name) || !record(value)) continue;
			presets[name] = { labels: labels(value.labels), compact: value.compact === true };
		}
	}
	return { enabled: s.enabled !== false, labels: labels(s.labels), compact: s.compact === true,
		presetName: cleanLabel(s.presetName, ''), selectedPreset: typeof s.selectedPreset === 'string' && hasOwn(presets, s.selectedPreset) ? s.selectedPreset : '',
		presets, folderRules: typeof s.folderRules === 'string' ? s.folderRules.slice(0, 8000) : '' };
}

/** Folder rules use the rendered report path, with the longest matching folder first. */
export function displayFor(settings: Settings, pro: boolean, path: string): Display | null {
	if (!settings.enabled) return null;
	if (!pro) return { labels: { ...LABELS }, compact: false };
	let chosen = settings.selectedPreset;
	const rules = settings.folderRules.split('\n').map((line) => {
		// Obsidian paths cannot contain a bar, so the first bar ends the folder. A preset name can contain a bar.
		const bar = line.indexOf('|');
		const folder = bar < 0 ? line : line.slice(0, bar);
		const preset = bar < 0 ? '' : line.slice(bar + 1);
		return { folder: folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''), preset: preset.trim() };
	}).filter((r) => r.folder && (path.startsWith(r.folder + '/') || path === r.folder)).sort((a, b) => b.folder.length - a.folder.length);
	const rule = rules[0];
	if (rule?.preset === 'off') return null;
	if (rule && hasOwn(settings.presets, rule.preset)) chosen = rule.preset;
	return hasOwn(settings.presets, chosen) ? settings.presets[chosen]! : { labels: settings.labels, compact: settings.compact };
}
