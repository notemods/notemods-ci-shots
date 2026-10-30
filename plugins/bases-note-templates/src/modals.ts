import { AbstractInputSuggest, Modal, Notice, Setting, SuggestModal, TFile, TFolder, type App } from 'obsidian';
import { MAX_TEMPLATES, extraFromRows, type BaseConfig } from './config';
import type { BaseContext } from './main';

/** Suggests Markdown notes (templates) or folders while the user types a path. */
class PathSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
		private readonly kind: 'note' | 'folder',
	) {
		super(app, input);
	}

	getSuggestions(query: string): string[] {
		const q = query.toLowerCase();
		const all = this.app.vault.getAllLoadedFiles();
		const paths = this.kind === 'note' ? all.filter((f): f is TFile => f instanceof TFile && f.extension === 'md').map((f) => f.path) : all.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot()).map((f) => f.path);
		return paths.filter((p) => p.toLowerCase().includes(q)).slice(0, 50);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		this.setValue(value);
		this.input.dispatchEvent(new Event('input'));
		this.close();
	}
}

/** Pro: pick one of the base's templates for the new note. */
export class TemplatePickModal extends SuggestModal<string> {
	private chosen = false;

	constructor(
		app: App,
		private readonly templates: string[],
		private readonly done: (path: string | null) => void,
	) {
		super(app);
		this.setPlaceholder('Template for the new note');
	}

	getSuggestions(query: string): string[] {
		const q = query.toLowerCase();
		return this.templates.filter((t) => t.toLowerCase().includes(q));
	}

	renderSuggestion(path: string, el: HTMLElement): void {
		const name = path.replace(/^.*\//, '').replace(/\.md$/, '');
		el.createDiv({ text: name });
		el.createEl('small', { text: path, cls: 'bnt-muted' });
	}

	onChooseSuggestion(path: string): void {
		this.chosen = true;
		this.done(path);
	}

	onClose(): void {
		super.onClose();
		// onChooseSuggestion runs after onClose; wait one tick before reporting "nothing chosen".
		window.setTimeout(() => {
			if (!this.chosen) this.done(null);
		}, 0);
	}
}

export interface SetupOptions {
	ctx: BaseContext;
	cfg: BaseConfig;
	views: string[];
	pro: boolean;
	onSave: (cfg: BaseConfig | null) => void;
}

/** Template, folder, name pattern and New button choice for one base. Pro adds more templates and view templates. */
export class SetupModal extends Modal {
	private cfg: BaseConfig;
	/** Extra properties as editable rows: a name can change, and two new rows never share a key. */
	private extraRows: { name: string; value: string }[];

	constructor(
		app: App,
		private readonly opts: SetupOptions,
	) {
		super(app);
		this.cfg = { ...opts.cfg, templates: [...opts.cfg.templates], views: { ...opts.cfg.views } };
		this.extraRows = Object.entries(opts.cfg.extraProps).map(([name, value]) => ({ name, value }));
	}

	onOpen(): void {
		this.modalEl.addClass('bnt-setup');
		this.setTitle(`Templates for ${this.opts.ctx.file.basename}`);
		this.render();
	}

	private pathSetting(el: HTMLElement, name: string, desc: string, value: string, kind: 'note' | 'folder', set: (v: string) => void): Setting {
		return new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.setPlaceholder(kind === 'note' ? 'Templates/Task.md' : 'Projects/Tasks').setValue(value).onChange((v) => set(v.trim()));
				new PathSuggest(this.app, text.inputEl, kind);
			});
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const { pro } = this.opts;
		const templates = this.cfg.templates.length ? this.cfg.templates : [''];
		templates.forEach((t, i) => {
			const s = this.pathSetting(el, i === 0 ? 'Template' : `Template ${i + 1}`, i === 0 ? 'Note whose properties and text start each new note. Empty = only the filter values.' : 'Pro. Offered in a list when you create a note.', t, 'note', (v) => {
				this.cfg.templates[i] = v;
			});
			if (i > 0) s.addExtraButton((b) => b.setIcon('trash').setTooltip('Remove').onClick(() => this.removeTemplate(i)));
		});
		new Setting(el).setDesc(pro ? 'More templates give a list to pick from.' : 'Pro: more than one template, with a list to pick from.').addButton((b) =>
			b
				.setButtonText('Add template')
				.setDisabled(!pro || templates.length >= MAX_TEMPLATES)
				.onClick(() => {
					this.cfg.templates = [...templates, ''];
					this.render();
				}),
		);
		this.renderViews(el);
		this.renderExtraProps(el);
		this.pathSetting(el, 'Folder', 'Where new notes go. Empty = the folder in the filters (file.inFolder), else your default location for new notes.', this.cfg.folder, 'folder', (v) => {
			this.cfg.folder = v;
		});
		new Setting(el)
			.setName('Name pattern')
			.setDesc('File name for new notes. Use {{date}}, {{date:YYYY-MM-DD}}, {{time}}, {{base}}, {{view}}, {{template}} and any filter property, for example {{project}}. Empty = Untitled.')
			.addText((text) => text.setPlaceholder('{{date}} {{project}}').setValue(this.cfg.pattern).onChange((v) => (this.cfg.pattern = v.trim())));
		new Setting(el)
			.setName('Apply when you press new')
			.setDesc('When on, a note you make with the new button of this base gets the template and the name pattern too.')
			.addToggle((t) => t.setValue(this.cfg.onNew).onChange((v) => (this.cfg.onNew = v)));
		this.renderButtons(el);
	}

	private renderViews(el: HTMLElement): void {
		const { pro, views } = this.opts;
		if (views.length < 2) return;
		new Setting(el).setName('Templates for single views').setHeading().setDesc(pro ? 'A view template comes first in the list for that view.' : 'Pro: a template for each view.');
		for (const view of views) {
			this.pathSetting(el, view, '', this.cfg.views[view] ?? '', 'note', (v) => {
				if (v) this.cfg.views[view] = v;
				else delete this.cfg.views[view];
			}).setDisabled(!pro);
		}
	}

	private renderExtraProps(el: HTMLElement): void {
		new Setting(el).setName('Extra properties').setHeading().setDesc('A property every new note of this base gets. A filter value or a template value with the same name wins over it.');
		this.extraRows.forEach((row, i) => {
			const s = new Setting(el);
			s.settingEl.addClass('bnt-extra');
			s.addText((text) => text.setPlaceholder('Name').setValue(row.name).onChange((v) => (row.name = v)))
				.addText((text) => text.setPlaceholder('Value').setValue(row.value).onChange((v) => (row.value = v)))
				.addExtraButton((b) =>
					b.setIcon('trash').setTooltip('Remove').onClick(() => {
						this.extraRows.splice(i, 1);
						this.render();
					}),
				);
		});
		new Setting(el).addButton((b) =>
			b
				.setButtonText('Add property')
				.setDisabled(this.extraRows.length >= MAX_TEMPLATES)
				.onClick(() => {
					this.extraRows.push({ name: '', value: '' });
					this.render();
				}),
		);
	}

	private renderButtons(el: HTMLElement): void {
		new Setting(el)
			.addButton((b) =>
				b.setButtonText('Remove setup').onClick(() => {
					this.opts.onSave(null);
					this.close();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText('Save')
					.setCta()
					.onClick(() => this.save()),
			);
	}

	private removeTemplate(i: number): void {
		this.cfg.templates.splice(i, 1);
		this.render();
	}

	private save(): void {
		const missing = [...this.cfg.templates, ...Object.values(this.cfg.views)].filter((p) => p && !this.app.vault.getFileByPath(p));
		if (missing.length) {
			new Notice(`Not found: ${missing.join(', ')}`);
			return;
		}
		this.opts.onSave({ ...this.cfg, templates: this.cfg.templates.filter(Boolean), extraProps: extraFromRows(this.extraRows) });
		this.close();
	}
}
