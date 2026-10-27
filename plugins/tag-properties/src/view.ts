import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import type TagPropertiesPlugin from './main';
import { basesFilter, matchingPaths, noteTags } from './tags';

export const VIEW_TYPE = 'tag-properties-view';
export class TagPropertiesView extends ItemView {
	selected = '';
	query = '';
	descendants = false;
	constructor(leaf: WorkspaceLeaf, private readonly host: TagPropertiesPlugin) { super(leaf); }
	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string { return 'Tag properties'; }
	getIcon(): string { return 'tags'; }
	onOpen(): Promise<void> { this.render(); return Promise.resolve(); }
	render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass('tag-properties-panel');
		root.createEl('h2', { text: 'Tag properties' });
		const properties = this.host.properties();
		root.createEl('p', { cls: 'tag-properties-muted', text: properties.length ? `Properties: ${properties.join(', ')}${this.host.includeCore() ? ' + core tags' : ''}` : 'Choose a list property in the plugin settings.' });
		const current = this.host.currentNote();
		if (current) {
			root.createEl('h3', { text: 'Current note' });
			const local = root.createDiv({ cls: 'tag-properties-chips' });
			for (const [tag] of noteTags(current, properties, this.host.includeCore())) this.chip(local, tag);
			if (!local.childElementCount) local.createEl('p', { text: 'No valid list tags in this note.' });
		}
		const search = root.createEl('input', { type: 'search', placeholder: 'Find a tag', attr: { 'aria-label': 'Find a tag' } });
		search.value = this.query;
		search.addEventListener('input', () => { this.query = search.value; this.renderResults(results); });
		const results = root.createDiv();
		this.renderResults(results);
	}
	private chip(parent: HTMLElement, tag: string, count?: number): void {
		const button = parent.createEl('button', { cls: 'tag-properties-chip', text: `#${tag}${count === undefined ? '' : ` · ${count}`}`, attr: { 'aria-pressed': String(this.selected === tag) } });
		button.addEventListener('click', () => { this.selected = tag; this.render(); });
	}
	private renderResults(root: HTMLElement): void {
		root.empty();
		const rows = this.host.index();
		root.createEl('h3', { text: `All tags · ${rows.length}` });
		const chips = root.createDiv({ cls: 'tag-properties-chips' });
		for (const row of rows.filter((r) => r.tag.includes(this.query.toLowerCase().replace(/^#/, '')))) this.chip(chips, row.tag, row.paths.length);
		if (!chips.childElementCount) root.createEl('p', { text: 'No matching tags. Use a YAML list of strings in your chosen property.' });
		if (!this.selected) return;
		root.createEl('h3', { text: `#${this.selected}` });
		const label = root.createEl('label', { cls: 'tag-properties-toggle' });
		const toggle = label.createEl('input', { type: 'checkbox' });
		toggle.checked = this.descendants;
		label.createSpan({ text: 'Include child tags' });
		toggle.addEventListener('change', () => { this.descendants = toggle.checked; this.render(); });
		const paths = matchingPaths(rows, this.selected, this.descendants);
		root.createEl('p', { text: `${paths.length} matching notes` });
		const list = root.createEl('ul', { cls: 'tag-properties-notes' });
		for (const path of paths) {
			const link = list.createEl('li').createEl('a', { text: path.replace(/\.md$/, ''), href: '#', attr: { 'aria-label': `Open ${path}` } });
			link.addEventListener('click', (event) => {
				event.preventDefault();
				const file = this.app.vault.getFileByPath(path);
				if (file) void this.app.workspace.getLeaf(event.ctrlKey || event.metaKey).openFile(file);
			});
		}
		root.createEl('h3', { text: 'Bases filter' });
		root.createEl('p', { cls: 'tag-properties-muted', text: 'Copy this expression into the advanced filter editor of a base.' });
		const expression = basesFilter(this.host.properties(), this.selected, this.descendants, this.host.includeCore());
		const field = root.createEl('textarea', { cls: 'tag-properties-filter', attr: { readonly: '', 'aria-label': 'Bases filter' } });
		field.value = expression;
		field.addEventListener('focus', () => field.select());
		const copy = root.createEl('button', { text: 'Copy bases filter' });
		const copyText = async (): Promise<void> => {
			try {
				await navigator.clipboard.writeText(expression);
				new Notice('Bases filter copied.');
			} catch {
				field.focus();
				field.select();
				new Notice('Select and copy the filter text.');
			}
		};
		copy.addEventListener('click', () => { void copyText(); });
	}
}
