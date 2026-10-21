import { BasesView, Keymap, MarkdownView, type BasesAllOptions, type BasesEntry, type BasesPropertyId, type BasesViewConfig, type QueryController } from 'obsidian';
import type BasesDateBacklinksPlugin from './main';
import { BASE_VIEW_ID } from './basefile';
import { dateWindow, matchDetails, type DateRow, type MatchOptions, type RollupPeriod } from './matcher';
import { isPro } from './pro';

export const KEY = {
	property: 'matchProperty',
	dateExpression: 'dailyNoteDate',
	dateFormat: 'dailyNoteFormat',
	period: 'rollupPeriod',
	weekStart: 'weekStart',
	additionalProperties: 'additionalProperties',
	rangeStart: 'rangeStart',
	rangeEnd: 'rangeEnd',
} as const;

function propertyNames(config: BasesViewConfig): BasesPropertyId[] {
	const primary = config.getAsPropertyId(KEY.property);
	const extras = config.get(KEY.additionalProperties);
	const extraNames = Array.isArray(extras)
		? extras
				.filter((x): x is string => typeof x === 'string')
				.map((x) => x.trim())
				.filter(Boolean)
				.map((x) => (x.startsWith('note.') ? x : `note.${x}`) as BasesPropertyId)
			: [];
	return [...new Set([primary, ...(isPro() ? extraNames : [])].filter((x): x is BasesPropertyId => !!x && x.startsWith('note.')))];
}

export function viewOptions(): BasesAllOptions[] {
	return [
		{
			type: 'property',
			key: KEY.property,
			displayName: 'Match date property',
			default: 'note.date',
			placeholder: 'Choose a date property',
			filter: (property) => property.startsWith('note.'),
		},
		{ type: 'formula', key: KEY.dateExpression, displayName: 'Daily note date', default: 'file.name', placeholder: 'file.name' },
		{ type: 'text', key: KEY.dateFormat, displayName: 'Daily note date format', default: 'YYYY-MM-DD', placeholder: 'YYYY-MM-DD' },
		{
			type: 'group',
			displayName: 'Pro',
			shouldHide: () => !isPro(),
			items: [
				{ type: 'dropdown', key: KEY.period, displayName: 'Roll up dates', default: 'day', options: { day: 'Day', week: 'Week', month: 'Month' } },
				{ type: 'dropdown', key: KEY.weekStart, displayName: 'Week starts', default: 'iso', options: { iso: 'Monday (ISO)', locale: 'Obsidian locale' } },
				{ type: 'multitext', key: KEY.additionalProperties, displayName: 'Also match date properties', default: [] },
				{ type: 'property', key: KEY.rangeStart, displayName: 'Range start property', placeholder: 'Choose a start date property', filter: (property) => property.startsWith('note.') },
				{ type: 'property', key: KEY.rangeEnd, displayName: 'Range end property', placeholder: 'Choose an end date property', filter: (property) => property.startsWith('note.') },
			],
		},
	];
}

export class DateBacklinksView extends BasesView {
	type = BASE_VIEW_ID;
	private readonly container: HTMLElement;
	private readonly plugin: BasesDateBacklinksPlugin;
	private renderTimer: number | null = null;
	private lastTarget = '';

	constructor(controller: QueryController, containerEl: HTMLElement, plugin: BasesDateBacklinksPlugin) {
		super(controller);
		this.container = containerEl;
		this.plugin = plugin;
	}

	onload(): void {
		this.registerEvent(this.app.workspace.on('file-open', () => {
			if (String(this.targetDate()) !== this.lastTarget) this.scheduleRender();
		}));
		this.register(this.plugin.onProChange(() => this.scheduleRender()));
		this.scheduleRender();
	}

	onunload(): void {
		if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		this.renderTimer = null;
	}

	onDataUpdated(): void {
		this.scheduleRender();
	}

	private scheduleRender(): void {
		if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		// Bases finishes assigning config and data after its synchronous callbacks.
		this.renderTimer = window.setTimeout(() => {
			this.renderTimer = null;
			this.render();
		}, 0);
	}

	private rows(): DateRow[] {
		const data = (this.data as BasesView['data'] | undefined)?.data ?? [];
		const ids = propertyNames(this.config);
		const start = isPro() ? this.config.getAsPropertyId(KEY.rangeStart) : null;
		const end = isPro() ? this.config.getAsPropertyId(KEY.rangeEnd) : null;
		const all = [...new Set([...ids, start, end].filter((x): x is BasesPropertyId => typeof x === 'string'))];
		return data.map((entry: BasesEntry) => ({
			id: entry.file.path,
			values: Object.fromEntries(all.map((id) => [id, entry.getValue(id)])),
		}));
	}

	private matchOptions(target: unknown): MatchOptions {
		const rawPeriod = this.config.get(KEY.period);
		const period: RollupPeriod = isPro() && (rawPeriod === 'week' || rawPeriod === 'month') ? rawPeriod : 'day';
		const rawFormat = this.config.get(KEY.dateFormat);
		return {
			target,
			dateFormat: typeof rawFormat === 'string' && rawFormat.trim() ? rawFormat.trim() : 'YYYY-MM-DD',
			period,
			weekStart: this.config.get(KEY.weekStart) === 'locale' ? 'locale' : 'iso',
			dateProperties: propertyNames(this.config),
			rangeStart: isPro() ? this.config.getAsPropertyId(KEY.rangeStart) : null,
			rangeEnd: isPro() ? this.config.getAsPropertyId(KEY.rangeEnd) : null,
		};
	}

	private targetDate(): unknown {
		if (!this.config) return null;
		try {
			// The default filename must remain local to its pane, including inactive splits.
			if (this.config.get(KEY.dateExpression) === 'file.name') {
				for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
					if (leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(this.container)) return leaf.view.file?.name;
				}
			}
			return this.config.getEvaluatedFormula(this, KEY.dateExpression);
		} catch { return null; }
	}

	private render(): void {
		// Bases assigns config after loading the view and then calls onDataUpdated.
		if (!this.config) return;
		this.container.empty();
		const root = this.container.createDiv({ cls: 'bases-date-backlinks' });
		const target = this.targetDate();
		this.lastTarget = String(target);
		const options = this.matchOptions(target);
		const window = dateWindow(options.target, options.dateFormat, options.period, options.weekStart);
		if (!window) {
			root.createDiv({ cls: 'bases-date-backlinks-empty', text: 'Open this Base inside a daily note whose date matches the selected format.' });
			return;
		}

		const properties = propertyNames(this.config);
		const title = window.start === window.end ? window.start : `${window.start} to ${window.end}`;
		root.createDiv({ cls: 'bases-date-backlinks-heading', text: `Notes dated ${title}` });
		if (properties.length === 0 && !(options.rangeStart && options.rangeEnd)) {
			root.createDiv({ cls: 'bases-date-backlinks-empty', text: 'Choose a date property in the Bases view settings.' });
			return;
		}

		const data = (this.data as BasesView['data'] | undefined)?.data ?? [];
		this.plugin.syncPropertyFilter([...properties, options.rangeStart, options.rangeEnd].filter((id): id is string => !!id));
		const matched = new Map(matchDetails(this.rows(), options).map((match) => [match.id, match]));
		if (matched.size === 0) {
			root.createDiv({ cls: 'bases-date-backlinks-empty', text: 'No notes match this date.' });
			return;
		}

		const list = root.createDiv({ cls: 'bases-date-backlinks-list' });
		for (const entry of data) {
			if (!matched.has(entry.file.path)) continue;
			const row = list.createDiv({ cls: 'bases-date-backlinks-row' });
			const link = row.createEl('a', { cls: 'internal-link', text: entry.file.basename, href: entry.file.path, attr: { 'data-href': entry.file.path } });
			const open = (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				void this.app.workspace.openLinkText(entry.file.path, this.app.workspace.getActiveFile()?.path ?? '', Keymap.isModEvent(event));
			};
			link.addEventListener('click', open);
			link.addEventListener('auxclick', (event) => { if (event.button === 1) open(event); });
			link.addEventListener('mouseover', (event) => this.app.workspace.trigger('hover-link', {
				event, source: BASE_VIEW_ID, hoverParent: this, targetEl: link, linktext: entry.file.path,
				sourcePath: this.app.workspace.getActiveFile()?.path ?? '',
			}));
			const match = matched.get(entry.file.path)!;
			const labels = match.properties.map((property) => this.config.getDisplayName(property as BasesPropertyId));
			if (match.range) labels.push('range');
			if (labels.length > 0) row.createSpan({ cls: 'bases-date-backlinks-property', text: labels.join(', ') });
		}
		root.createDiv({ cls: 'bases-date-backlinks-count', text: `${matched.size} ${matched.size === 1 ? 'note' : 'notes'}` });
	}
}
