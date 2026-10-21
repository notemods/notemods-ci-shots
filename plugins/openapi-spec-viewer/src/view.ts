import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type LocalApiPlugin from './main';
import { MAX_BYTES, object, parseSpec, schemaDetails, text, type Endpoint, type Spec } from './model';
import { isPro, PRO_UI } from './pro';
export const VIEW_TYPE = 'local-api-reference';
function button(parent: HTMLElement, label: string, action: () => void, cls = ''): HTMLButtonElement {
	const b = parent.createEl('button', { text: label, cls }); b.addEventListener('click', action); return b;
}
export class ReferenceView extends ItemView {
	path = '';
	spec: Spec | null = null;
	error = '';
	selected = '';
	tag = '';
	private generation = 0;
	constructor(leaf: WorkspaceLeaf, readonly owner: LocalApiPlugin) { super(leaf); }
	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string { return 'Local API reference'; }
	getState(): Record<string, unknown> { return { path: this.path }; }
	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		this.path = text(object(state).path); await this.reload(); await super.setState(state, result);
	}
	onOpen(): Promise<void> { this.owner.views.add(this); this.render(); return Promise.resolve(); }
	onClose(): Promise<void> { this.generation++; this.owner.views.delete(this); return Promise.resolve(); }
	async reload(): Promise<void> {
		const generation = ++this.generation;
		this.spec = null; this.error = '';
		try {
			const file = this.app.vault.getFileByPath(this.path);
			if (!file) throw new Error('Source file not found. Select a file in the vault.');
			if (!/^(json|ya?ml)$/i.test(file.extension)) throw new Error('Select a JSON or YAML file.');
			if (file.stat.size > MAX_BYTES) throw new Error('File exceeds the 5 MiB limit.');
			const source = await this.app.vault.read(file);
			if (generation !== this.generation) return;
			this.spec = parseSpec(source, file.extension);
			if (!this.spec.endpoints.some((e) => e.id === this.selected)) this.selected = this.spec.endpoints[0]?.id ?? '';
		} catch (error) { if (generation !== this.generation) return; this.error = error instanceof Error ? error.message : 'Could not read the source file.'; }
		this.render();
	}
	render(): void {
		const el = this.contentEl; el.empty(); el.addClass('lar-view');
		const head = el.createDiv({ cls: 'lar-header' });
		head.createEl('p', { text: 'Local API reference', cls: 'lar-eyebrow' });
		head.createEl('h2', { text: this.spec?.title ?? 'Local API reference' });
		head.createEl('p', { text: this.path || 'Select a JSON or YAML file with the command palette.', cls: 'lar-source' });
		button(head, 'Reload source', () => void this.reload());
		if (this.error) { el.createEl('p', { text: this.error, cls: 'lar-error', attr: { role: 'alert' } }); return; }
		if (!this.spec) return;
		head.createEl('p', { text: `OpenAPI ${this.spec.version} · ${this.spec.endpoints.length} endpoints · Read only`, cls: 'lar-meta' });
		for (const warning of this.spec.warnings) el.createEl('p', { text: warning, cls: 'lar-error' });
		const controls = el.createDiv({ cls: 'lar-controls' });
		const select = controls.createEl('select', { attr: { 'aria-label': 'Tag filter' } });
		select.createEl('option', { text: 'Show all tags', value: '' });
		const tags = [...new Set(this.spec.endpoints.flatMap((e) => e.tags))];
		for (const tag of tags) select.createEl('option', { text: tag, value: tag });
		if (!tags.includes(this.tag)) this.tag = '';
		select.value = this.tag;
		select.addEventListener('change', () => { this.tag = select.value; this.render(); });
		if (isPro()) {
			const name = controls.createEl('input', { attr: { placeholder: 'Filter name', 'aria-label': 'Filter name' } });
			button(controls, 'Save filter (Pro)', () => { void this.owner.saveFilter(name.value, this.tag).then(() => this.render()); });
			for (const filter of this.owner.settings.filters) button(controls, filter.name, () => { this.tag = filter.tag; this.render(); }, 'lar-saved-filter');
		}
		const body = el.createDiv({ cls: 'lar-body' });
		const nav = body.createEl('nav', { cls: 'lar-endpoints', attr: { 'aria-label': 'Endpoints by tag' } });
		if (isPro() && this.owner.settings.bookmarks.some((b) => b.source === this.path)) {
			nav.createEl('h3', { text: PRO_UI.bookmarkHeading });
			for (const mark of this.owner.settings.bookmarks.filter((b) => b.source === this.path)) button(nav, mark.endpoint, () => { this.selected = mark.endpoint; this.render(); });
		}
		for (const tag of tags.filter((t) => !this.tag || t === this.tag)) {
			nav.createEl('h3', { text: tag });
			for (const endpoint of this.spec.endpoints.filter((e) => e.tags.includes(tag))) {
				const b = button(nav, '', () => { this.selected = endpoint.id; this.render(); }, 'lar-endpoint');
				b.setAttribute('aria-pressed', String(this.selected === endpoint.id));
				b.createSpan({ text: endpoint.method, cls: 'lar-method' }); b.createSpan({ text: endpoint.path });
				if (endpoint.summary) b.createEl('small', { text: endpoint.summary });
			}
		}
		if (!this.spec.endpoints.length) nav.createEl('p', { text: 'No endpoints found in paths.' });
		const detail = body.createEl('section', { cls: 'lar-detail', attr: { 'aria-label': 'Endpoint details' } });
		const endpoint = this.spec.endpoints.find((e) => e.id === this.selected);
		if (endpoint) this.renderEndpoint(detail, endpoint); else detail.createEl('p', { text: 'Select an endpoint.' });
	}
	private renderEndpoint(el: HTMLElement, e: Endpoint): void {
		el.createEl('h2', { text: e.id });
		el.createEl('h3', { text: e.summary || 'Endpoint details' });
		el.createEl('p', { text: e.description, cls: 'lar-description' });
		if (isPro()) {
			const actions = el.createDiv({ cls: 'lar-controls' });
			button(actions, 'Write endpoint note (Pro)', () => void this.owner.exportEndpoint(e, this.path));
			const saved = this.owner.settings.bookmarks.some((b) => b.source === this.path && b.endpoint === e.id);
			button(actions, saved ? 'Remove bookmark (Pro)' : 'Bookmark endpoint (Pro)', () => { void this.owner.bookmark(this.path, e.id).then(() => this.render()); });
		}
		for (const warning of e.warnings) el.createEl('p', { text: warning, cls: 'lar-error' });
		el.createEl('h3', { text: 'Parameters' });
		if (!e.parameters.length) el.createEl('p', { text: 'No parameters declared.' });
		else {
			const table = el.createEl('table'); const header = table.createEl('thead').createEl('tr');
			for (const label of ['Name', 'In', 'Type', 'Required']) header.createEl('th', { text: label });
			const body = table.createEl('tbody');
			for (const p of e.parameters) { const row = body.createEl('tr'); for (const v of [p.name, p.location, p.type, p.required ? 'required' : 'optional']) row.createEl('td', { text: v }); }
		}
		el.createEl('h3', { text: 'Request content types' });
		el.createEl('p', { text: e.requestTypes.join(', ') || 'No request content declared.' });
		el.createEl('h3', { text: 'Responses' });
		for (const response of e.responses) el.createEl('p', { text: `${response.code} — ${response.description}`, cls: 'lar-response' });
		if (!e.responses.length) el.createEl('p', { text: 'No responses declared.' });
		el.createEl('h3', { text: 'Schemas' });
		const links = el.createDiv({ cls: 'lar-schema-links' }); const panel = el.createDiv({ cls: 'lar-schema' });
		for (const link of e.schemas) button(links, `${link.label}${text(object(link.schema).$ref) ? ` · ${text(object(link.schema).$ref)}` : ''}`, () => this.renderSchema(panel, link.schema));
		if (!e.schemas.length) panel.createEl('p', { text: 'No schemas declared.' });
	}
	private renderSchema(el: HTMLElement, schema: unknown): void {
		if (!this.spec) return;
		el.empty(); const detail = schemaDetails(this.spec.root, schema);
		el.createEl('h4', { text: detail.title });
		if (detail.error) { el.createEl('p', { text: detail.error, cls: 'lar-error' }); return; }
		el.createEl('p', { text: `Type: ${detail.type} · One level of properties` });
		for (const p of detail.properties) {
			const row = el.createDiv({ cls: 'lar-property' });
			row.createSpan({ text: `${p.name}: ${p.type}${p.required ? ' · required' : ''}` });
			if (text(object(p.schema).$ref)) button(row, 'Open reference', () => this.renderSchema(el, p.schema));
		}
		const items = object(resolveSchema(this.spec.root, schema)).items;
		if (items) button(el, 'Open array items', () => this.renderSchema(el, items));
	}
}
import { resolve as resolveReference } from './model';
function resolveSchema(root: Record<string, unknown>, schema: unknown): unknown { return resolveReference(root, schema).value; }
