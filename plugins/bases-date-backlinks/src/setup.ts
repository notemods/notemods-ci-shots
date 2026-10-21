import { getObsidianMoment } from './obsidian-moment';

export interface DailyConfig { template: string; format: string }

/** Periodic Notes takes precedence only when its daily notes are enabled. */
export function dailyConfig(core: unknown, periodic: unknown): DailyConfig {
	const c = core && typeof core === 'object' ? core as Record<string, unknown> : {};
	const p = periodic && typeof periodic === 'object' ? periodic as Record<string, unknown> : {};
	const daily = p.daily && typeof p.daily === 'object' ? p.daily as Record<string, unknown> : {};
	const source = daily.enabled === true ? daily : c;
	return {
		template: typeof source.template === 'string' ? source.template.trim() : '',
		format: typeof source.format === 'string' && source.format.trim() ? source.format.trim() : 'YYYY-MM-DD',
	};
}

export function isDailyName(basename: string, format: string): boolean {
	return getObsidianMoment()(basename, format, true).isValid();
}
