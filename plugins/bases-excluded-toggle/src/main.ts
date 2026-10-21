import { Notice, Plugin, PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { createGitHubSponsors, sponsorsSettingItems } from './license/github-obsidian';
import { bindPro, isPro, onProChange, PRO_UI, SPONSORS } from './pro';
import { refreshAffectedViews } from './refresh';
import { applyPresetFilters, mergeFilters, parseFilterList, restoreFilters, toggleFilters } from './toggle';

interface PluginData {
	savedFilters: string[] | null;
	presets: Record<string, string[]>;
}

const DEFAULT_DATA: PluginData = { savedFilters: null, presets: {} };
const ONE_TIME_URL = 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-excluded-toggle';

function strings(value: unknown): string[] | null {
	return parseFilterList(value);
}

function record(value: unknown): Record<string, string[]> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
	const out: Record<string, string[]> = {};
	for (const [key, list] of Object.entries(value)) {
		const filters = strings(list);
		if (key.trim() && filters) out[key] = filters;
	}
	return out;
}

export default class BasesExcludedTogglePlugin extends Plugin {
	data: PluginData = { ...DEFAULT_DATA };
	pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
	private settingTab: ExcludedSettingTab | null = null;

	async onload(): Promise<void> {
		this.data = this.normalize(await this.loadData());
		this.pro.init();
		bindPro(this.pro);
		this.register(onProChange(() => this.settingTab?.update()));
		this.settingTab = new ExcludedSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.addCommand({ id: 'toggle-visibility', name: 'Toggle excluded files visibility', callback: () => void this.toggleVisibility() });
		this.addRibbonIcon('eye', 'Toggle excluded files visibility', () => void this.toggleVisibility());
		this.app.workspace.onLayoutReady(() => {
			void this.pro.refresh();
			this.registerInterval(window.setInterval(() => void this.pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}

	onunload(): void {
		bindPro(null);
		try {
			const current = this.readFilters();
			const restored = restoreFilters(current, this.data.savedFilters);
			if (restored) {
				this.writeFilters(restored);
				this.data.savedFilters = null;
				void this.saveData(this.data);
			}
		} catch (error) {
			new Notice(`Excluded Files Toggle: could not restore patterns during unload. ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private normalize(value: unknown): PluginData {
		if (typeof value !== 'object' || value === null) return { ...DEFAULT_DATA };
		const raw = value as Partial<PluginData>;
		return {
			savedFilters: strings(raw.savedFilters),
			presets: record(raw.presets),
		};
	}

	readFilters(): string[] {
		if (typeof this.app.vault.getConfig !== 'function') throw new Error('This Obsidian version does not expose the Excluded files setting API.');
		const value: unknown = this.app.vault.getConfig('userIgnoreFilters');
		const filters = strings(value);
		if (!filters) throw new Error('Obsidian returned an unsupported Excluded files value. Your exclusions were not changed.');
		return filters;
	}

	private writeFilters(filters: string[]): void {
		if (typeof this.app.vault.setConfig !== 'function') throw new Error('This Obsidian version does not expose the Excluded files setting API.');
		this.app.vault.setConfig('userIgnoreFilters', filters);
	}

	private async save(): Promise<void> {
		await this.saveData(this.data);
		this.settingTab?.update();
	}

	async toggleVisibility(): Promise<void> {
		try {
			const current = this.readFilters();
			const result = toggleFilters(current, this.data.savedFilters);
			if (result.action === 'empty') {
				new Notice('The excluded files list is empty. Add a pattern in settings, then toggle visibility.');
				return;
			}
			if (result.action === 'show') {
				this.data.savedFilters = result.savedFilters;
				await this.saveData(this.data);
				this.writeFilters(result.nextFilters);
				new Notice('Excluded files are temporarily visible. Toggle again to restore them.');
			} else {
				this.writeFilters(result.nextFilters);
				this.data.savedFilters = null;
				await this.save();
				new Notice('Excluded files are hidden again.');
			}
			await refreshAffectedViews(this.app);
		} catch (error) {
			new Notice(`Excluded Files Toggle: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async savePreset(name: string): Promise<void> {
		if (!isPro()) return;
		try {
			const filters = this.data.savedFilters ?? this.readFilters();
			this.data.presets[name] = mergeFilters(filters);
			await this.save();
		} catch (error) {
			new Notice(`Could not save preset. ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async applyPreset(name: string): Promise<void> {
		if (!isPro()) return;
		const result = applyPresetFilters(this.data.presets, name);
		if (!result) return;
		try {
			this.writeFilters(result.nextFilters);
			this.data.savedFilters = result.savedFilters;
			await this.save();
			await refreshAffectedViews(this.app);
			new Notice(`Excluded files preset “${name}” applied.`);
		} catch (error) {
			new Notice(`Could not apply preset. ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async deletePreset(name: string): Promise<void> {
		delete this.data.presets[name];
		await this.save();
	}
}

class ExcludedSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: BasesExcludedTogglePlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const items: SettingDefinitionItem[] = this.plugin.pro ? [...sponsorsSettingItems(this.plugin.pro, PRO_UI)] : [];
		const visible = this.plugin.data.savedFilters !== null;
		const ownItems: Exclude<SettingDefinitionItem, { type: 'group' | 'list' } | { type: 'page' }>[] = [
			{
				name: 'Excluded files',
				desc: visible ? 'The saved patterns are temporarily clear. Search, graph and Bases can show those files.' : 'Toggle the native Excluded files patterns for the whole vault.',
				render: (setting) => { setting.addButton((button) => button.setButtonText(visible ? 'Restore patterns' : 'Show excluded files').onClick(() => void this.plugin.toggleVisibility())); },
			},
		];
		if (!isPro()) {
			ownItems.push({
				name: 'Get pro',
				desc: 'Pro saves named exclusion presets.',
				render: (setting) => { setting.setDesc(createFragment((fragment) => {
					fragment.appendText('Pro saves named exclusion presets. ');
					fragment.createEl('a', { text: '$15 one time', href: ONE_TIME_URL });
				})); },
			});
			items.push({ type: 'group', heading: 'Excluded files', items: ownItems });
			return items;
		}
		let presetName = '';
		ownItems.push({
			name: 'Save current patterns as a preset',
			desc: 'Presets contain the patterns that are active now, or saved for restore while visibility is on.',
			render: (setting) => {
				setting.addText((text) => text.setPlaceholder('Archive').onChange((value) => (presetName = value.trim())));
				setting.addButton((button) => button.setButtonText('Save preset').setCta().onClick(() => {
					if (presetName) void this.plugin.savePreset(presetName);
				}));
			},
		});
		for (const name of Object.keys(this.plugin.data.presets).sort((a, b) => a.localeCompare(b))) {
			items.push({
				name,
				desc: `${this.plugin.data.presets[name]?.length ?? 0} exclusion patterns`,
				render: (setting) => {
					setting.addButton((button) => button.setButtonText('Apply').onClick(() => void this.plugin.applyPreset(name)));
					setting.addExtraButton((button) => button.setIcon('trash').setTooltip(`Delete ${name}`).onClick(() => void this.plugin.deletePreset(name)));
				},
			});
		}
		items.push({ type: 'group', heading: 'Excluded files', items: ownItems });
		return items;
	}
}
