// Pro: hands a new note to Templater when its text still holds Templater tags (<% %>).
// Templater has no Obsidian API; this uses the method other plugins call (templater.overwrite_file_commands).
// Every step checks the shape first, so a missing or changed Templater leaves the note as it is.
import type { App, TFile } from 'obsidian';

export type TemplaterResult = 'no-tags' | 'done' | 'ran' | 'missing';

/** Templater may process the note by itself ("Trigger Templater on new file creation"); this is how long to give it. */
const OWN_TRIGGER_MS = 700;
const TAG = /<%[\s\S]*?%>/;

type Overwrite = (file: TFile, activeFile?: boolean) => Promise<void>;

/** Templater's overwrite method, or null when Templater is not on or looks different. */
export function templaterOverwrite(app: App): Overwrite | null {
	const plugins = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins;
	if (!plugins || typeof plugins.getPlugin !== 'function') return null;
	const plugin = plugins.getPlugin('templater-obsidian') as { templater?: { overwrite_file_commands?: unknown } } | null;
	const core = plugin?.templater;
	if (!core || typeof core.overwrite_file_commands !== 'function') return null;
	const fn = core.overwrite_file_commands as Overwrite;
	return (file, activeFile) => fn.call(core, file, activeFile);
}

/** Runs Templater on file if tags are left after Templater's own trigger had its chance. */
export async function runTemplater(app: App, file: TFile, waitMs = OWN_TRIGGER_MS): Promise<TemplaterResult> {
	if (!TAG.test(await app.vault.read(file))) return 'no-tags';
	await new Promise((r) => window.setTimeout(r, waitMs));
	if (!TAG.test(await app.vault.read(file))) return 'done';
	const overwrite = templaterOverwrite(app);
	if (!overwrite) return 'missing';
	await overwrite(file, false);
	return 'ran';
}
