import { PluginSettingTab, type SettingDefinitionItem, type TFile } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import { isPreambleExtension } from './preamble';
import type SharedTexPreamblePlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface MacroLibrary {
	name: string;
	path: string;
}

export interface SharedTexPreambleSettings {
	/** Vault path of the macro file (free). */
	path: string;
	/** Pro: named macro libraries. */
	libraries: MacroLibrary[];
	/** Pro: name of the library to load instead of the macro file. Empty = the macro file. */
	active: string;
}

export const DEFAULT_SETTINGS: SharedTexPreambleSettings = {
	path: '',
	libraries: [],
	active: '',
};

/** The most libraries that the settings keep. */
export const MAX_LIBRARIES = 20;

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<SharedTexPreambleSettings> | null | undefined): SharedTexPreambleSettings {
	const s = saved ?? {};
	const libs = Array.isArray(s.libraries) ? s.libraries : [];
	const libraries: MacroLibrary[] = [];
	for (const l of libs) {
		if (libraries.length >= MAX_LIBRARIES) break;
		if (!l || typeof l !== 'object') continue;
		const name = typeof l.name === 'string' ? l.name.trim() : '';
		const path = typeof l.path === 'string' ? l.path.trim() : '';
		if (name === '' || libraries.some((x) => x.name === name)) continue;
		libraries.push({ name, path });
	}
	const active = typeof s.active === 'string' && libraries.some((l) => l.name === s.active) ? s.active : '';
	return {
		path: typeof s.path === 'string' ? s.path.trim() : DEFAULT_SETTINGS.path,
		libraries,
		active,
	};
}

/** A library name that is not in use: "Library 1", "Library 2" and so on. */
export function nextLibraryName(libraries: readonly MacroLibrary[]): string {
	for (let i = 1; ; i++) {
		const name = `Library ${i}`;
		if (!libraries.some((l) => l.name === name)) return name;
	}
}

const LIB_KEY = /^lib\.(\d+)\.(name|path)$/;

export class SharedTexPreambleSettingTab extends PluginSettingTab {
	plugin: SharedTexPreamblePlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: SharedTexPreamblePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		const s = this.plugin.settings;
		const pro = isPro();
		const filter = (f: TFile) => isPreambleExtension(f.extension);
		return [
			{
				name: 'Macro file',
				desc: 'A Markdown, .tex or .sty file in this vault with plain definitions: \\newcommand, \\renewcommand, \\providecommand, \\def and \\DeclareMathOperator. In a Markdown file, the plugin reads the $$ blocks and the tex or latex code blocks.',
				control: { type: 'file', key: 'path', defaultValue: '', placeholder: 'Macros.md', filter },
			},
			{
				name: 'Reload the macros',
				desc: this.plugin.statusText(),
				action: () => void this.plugin.reload('command'),
			},
			{
				name: 'Removed definitions',
				desc: 'The math engine keeps each definition until Obsidian restarts. When you remove a definition from the file, notes can still use it until you restart the app. A changed definition takes effect at the next reload.',
			},
			{
				type: 'list',
				heading: 'Named libraries (Pro)',
				emptyState: pro ? 'No library yet. Add one with the + button.' : 'Named libraries are a Pro feature.',
				addItem: {
					name: 'Add a library',
					action: () => void this.addLibrary(),
				},
				onDelete: (index: number) => void this.deleteLibrary(index),
				items: s.libraries.flatMap((lib, i) => [
					{
						name: `Name of library ${i + 1}`,
						control: { type: 'text' as const, key: `lib.${i}.name`, defaultValue: lib.name, validate: (v: string) => this.validateName(v, i) },
					},
					{
						name: `File of ${lib.name}`,
						control: { type: 'file' as const, key: `lib.${i}.path`, defaultValue: '', placeholder: 'Macros/Physics.md', filter },
					},
				]),
			},
			{
				name: 'Active library (Pro)',
				desc: 'The library to load instead of the macro file. Select "Macro file" to use the file above.',
				control: {
					type: 'dropdown',
					key: 'active',
					defaultValue: '',
					options: Object.fromEntries([['', 'Macro file'], ...s.libraries.map((l) => [l.name, l.name])]) as Record<string, string>,
					disabled: () => !isPro(),
				},
			},
			{
				name: 'Preview a library (Pro)',
				desc: 'Show the definitions of a library, a sample of each, and its errors. The preview does not load the library.',
				action: () => this.plugin.choosePreview(),
				disabled: () => !isPro(),
			},
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	validateName(value: string, index: number): string | void {
		const v = value.trim();
		if (v === '') return 'Type a name.';
		if (this.plugin.settings.libraries.some((l, i) => i !== index && l.name === v)) return 'Another library has this name.';
	}

	getControlValue(key: string): unknown {
		const m = LIB_KEY.exec(key);
		if (m) return this.plugin.settings.libraries[Number(m[1])]?.[m[2] as 'name' | 'path'];
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings;
		const m = LIB_KEY.exec(key);
		if (m) {
			if (!isPro()) {
				this.plugin.needsPro('Named libraries');
				this.update();
				return;
			}
			const lib = s.libraries[Number(m[1])];
			if (!lib) return;
			const text = typeof value === 'string' ? value.trim() : '';
			if (m[2] === 'name') {
				if (this.validateName(text, Number(m[1]))) return;
				if (s.active === lib.name) s.active = text;
				lib.name = text;
			} else {
				lib.path = text;
			}
			this.plugin.settings = normalizeSettings(s);
			await this.plugin.saveSettings();
			this.update();
			return;
		}
		if (key === 'active' && !isPro()) {
			this.plugin.needsPro('Named libraries');
			this.update();
			return;
		}
		const before = this.plugin.activePath();
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		await this.plugin.saveSettings();
		if (key === 'active') this.update();
		if (this.plugin.activePath() !== before && this.plugin.activePath() !== '') void this.plugin.reload('command');
	}

	async addLibrary(): Promise<void> {
		if (!isPro()) {
			this.plugin.needsPro('Named libraries');
			return;
		}
		const s = this.plugin.settings;
		if (s.libraries.length >= MAX_LIBRARIES) return;
		s.libraries.push({ name: nextLibraryName(s.libraries), path: '' });
		await this.plugin.saveSettings();
		this.update();
	}

	async deleteLibrary(index: number): Promise<void> {
		const s = this.plugin.settings;
		const lib = s.libraries[index];
		if (!lib) return;
		s.libraries.splice(index, 1);
		if (s.active === lib.name) s.active = '';
		await this.plugin.saveSettings();
		this.update();
	}
}
