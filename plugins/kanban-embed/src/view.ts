import { Component, Keymap, MarkdownRenderChild, MarkdownRenderer, Menu, TFile, setIcon } from 'obsidian';
import { buildView, parseConfig, type EmbedConfig, type EmbedView, type SourceBoard, type ViewCard, type ViewColumn } from './embed';
import { FREE_MAX_BOARDS, isPro, onProChange, proNotice } from './pro';
import { UNASSIGNED_KEY, describeSwimlane, dropIndex, groupSwimlanes, rowOf, rowSuffix, type SwimRow, type SwimlaneSpec } from './swimlanes';
import type KanbanEmbedPlugin from './main';

export const BLOCK_ID = 'kanban-embed';
const REDRAW_MS = 250;
const DRAG_TYPE = 'application/x-kanban-embed-card';

/** The card being dragged, with the embed it came from. Drops into another embed are refused. */
let dragging: { embed: BoardEmbed; card: ViewCard } | null = null;

/** One kanban-embed code block: reads the boards, draws the lanes and writes card changes back to the board files. */
export class BoardEmbed extends MarkdownRenderChild {
	/** The newest drawn state, for tests and the move menu. */
	view: EmbedView | null = null;
	config: EmbedConfig;
	boards: SourceBoard[] = [];
	draws = 0;
	private timer: number | null = null;
	private token = 0;
	private paths = new Set<string>();
	private drawnKey = '';
	private adding = false;
	/** Owner of the rendered card text of the board on screen. A redraw unloads it, so old render children do not pile up. */
	private cardsOwner: Component | null = null;

	constructor(
		private readonly plugin: KanbanEmbedPlugin,
		containerEl: HTMLElement,
		source: string,
		private readonly sourcePath: string,
	) {
		super(containerEl);
		this.config = parseConfig(source);
	}

	onload(): void {
		this.containerEl.addClass('kanban-embed');
		// In Live Preview the editor would take a press inside the block as a click into the code block source,
		// which hides the board in the middle of a drag or a click. The board handles its own presses.
		this.registerDomEvent(this.containerEl, 'mousedown', (evt) => evt.stopPropagation());
		this.containerEl.createDiv({ cls: 'kanban-embed-note', text: 'Reading the board...' });
		this.plugin.embeds.add(this);
		const touch = (path: string) => {
			if (this.paths.has(path)) this.schedule();
		};
		this.registerEvent(this.plugin.app.vault.on('modify', (f) => touch(f.path)));
		this.registerEvent(this.plugin.app.vault.on('delete', (f) => touch(f.path)));
		this.registerEvent(
			this.plugin.app.vault.on('rename', (f, old) => {
				touch(old);
				touch(f.path);
			}),
		);
		this.registerEvent(
			this.plugin.app.vault.on('create', () => {
				if (this.boards.length < this.config.boards.length) this.schedule();
			}),
		);
		this.register(onProChange(() => this.schedule(0)));
		this.schedule(0);
	}

	onunload(): void {
		this.plugin.embeds.delete(this);
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.token++;
	}

	/** Redraws after `delay` ms; calls in between restart the wait. */
	schedule(delay = REDRAW_MS): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.draw();
		}, delay);
	}

	/** The board files named in the block, resolved like links from the note that holds the block. */
	private resolveBoards(): { files: TFile[]; missing: string[] } {
		const files: TFile[] = [];
		const missing: string[] = [];
		for (const link of this.config.boards) {
			const f = this.plugin.app.metadataCache.getFirstLinkpathDest(link, this.sourcePath);
			if (f && f.extension === 'md') files.push(f);
			else missing.push(link);
		}
		return { files, missing };
	}

	async draw(): Promise<void> {
		// A redraw would remove the open add-card field, so it waits until the field closes.
		if (this.adding) return this.schedule(REDRAW_MS * 2);
		const token = ++this.token;
		const { files, missing } = this.resolveBoards();
		const shown = isPro() ? files : files.slice(0, FREE_MAX_BOARDS);
		const boards = await Promise.all(shown.map(async (f) => ({ path: f.path, name: f.basename, markdown: await this.plugin.app.vault.cachedRead(f) })));
		if (token !== this.token) return;
		this.paths = new Set([...files.map((f) => f.path), ...missing]);
		// Same files, same Pro state and same settings: the board on screen is current, so keep it (and any open menu).
		const key = JSON.stringify([boards.map((b) => [b.path, b.markdown]), missing, files.length, isPro(), this.plugin.settings]);
		if (key === this.drawnKey && this.view !== null) return;
		this.drawnKey = key;
		this.boards = boards;
		const hideDone = this.config.hideDone ?? this.plugin.settings.hideDone;
		this.view = buildView(boards, { lanes: this.config.lanes, hideDone, filter: isPro() ? this.config.filter : [] });
		this.render(this.view, missing, files.length - shown.length);
		this.draws++;
	}

	private render(view: EmbedView, missing: string[], cut: number): void {
		const el = this.containerEl;
		el.empty();
		if (this.cardsOwner) this.removeChild(this.cardsOwner);
		this.cardsOwner = this.addChild(new Component());
		el.setCssProps({ '--kanban-embed-lane-width': `${this.plugin.settings.laneWidth}px` });
		this.renderHeader(el, view);
		const notes: string[] = [...this.config.errors];
		for (const m of missing) notes.push(`No note found for ${m}.`);
		for (const p of view.notBoards) notes.push(`${p} has no kanban-plugin frontmatter key, so it may not be a board. Its headings are shown as lanes.`);
		if (view.missingLanes.length > 0) notes.push(`No lane named ${view.missingLanes.join(', ')}.`);
		if (cut > 0) notes.push(`Showing the first board. Pro shows all ${cut + FREE_MAX_BOARDS} boards in one embed.`);
		if (!isPro() && this.config.filter.length > 0) notes.push('The filter line is a Pro feature, so every card is shown.');
		if (!isPro() && this.config.swimlane) notes.push('The swimlane line is a Pro feature, so the cards are shown without rows.');
		for (const n of notes) el.createDiv({ cls: 'kanban-embed-note mod-warning', text: n });
		if (this.boards.length === 0) return;
		const spec = isPro() ? this.config.swimlane : undefined;
		if (spec && view.columns.length > 0) this.renderSwim(el, view, spec);
		else {
			const lanesEl = el.createDiv({ cls: 'kanban-embed-lanes' });
			view.columns.forEach((col, i) => this.renderColumn(lanesEl, col, i));
		}
		if (view.columns.length === 0) el.createDiv({ cls: 'kanban-embed-note', text: 'This board has no lanes. A lane is a heading in the board file.' });
	}

	private renderHeader(el: HTMLElement, view: EmbedView): void {
		const head = el.createDiv({ cls: 'kanban-embed-header' });
		const title = head.createDiv({ cls: 'kanban-embed-title' });
		if (this.config.title !== '') title.createSpan({ text: this.config.title });
		else
			this.boards.forEach((b, i) => {
				if (i > 0) title.appendText(' + ');
				this.link(title, b.name, b.path, this.sourcePath);
			});
		const count = `${view.cards} ${view.cards === 1 ? 'card' : 'cards'}`;
		head.createDiv({ cls: 'kanban-embed-count', text: view.hidden > 0 ? `${count}, ${view.hidden} hidden` : count });
	}

	/** An internal link that opens on click (new tab with Ctrl or Cmd) and shows a page preview on hover. */
	private link(parent: HTMLElement, text: string, target: string, sourcePath: string): HTMLAnchorElement {
		const a = parent.createEl('a', { cls: 'internal-link', text, href: target, attr: { 'data-href': target } });
		a.addEventListener('click', (evt) => {
			evt.preventDefault();
			void this.plugin.app.workspace.openLinkText(target, sourcePath, Keymap.isModEvent(evt));
		});
		a.addEventListener('mouseover', (event) => {
			this.plugin.app.workspace.trigger('hover-link', { event, source: BLOCK_ID, hoverParent: this, targetEl: a, linktext: target, sourcePath });
		});
		return a;
	}

	private renderColumn(parent: HTMLElement, col: ViewColumn, colIndex: number): void {
		const lane = parent.createDiv({ cls: 'kanban-embed-lane', attr: { 'data-lane': col.title } });
		if (col.complete) lane.addClass('mod-complete');
		const head = lane.createDiv({ cls: 'kanban-embed-lane-header' });
		head.createSpan({ cls: 'kanban-embed-lane-title', text: col.title });
		const count = head.createSpan({ cls: 'kanban-embed-lane-count', text: col.maxItems > 0 ? `${col.total}/${col.maxItems}` : String(col.total) });
		if (col.maxItems > 0 && col.total > col.maxItems) {
			count.addClass('mod-over');
			lane.addClass('mod-over');
		}
		const list = lane.createDiv({ cls: 'kanban-embed-cards' });
		for (const card of col.cards) this.renderCard(list, card, colIndex);
		if (col.cards.length === 0) list.createDiv({ cls: 'kanban-embed-empty', text: col.total > 0 ? 'All cards hidden' : 'No cards' });
		this.bindDrop(list, col);
		this.renderAdd(lane, col);
	}

	/** Key of the folded rows of this embed in the plugin data: the note, the boards and the swimlane line. */
	private collapseKey(spec: SwimlaneSpec): string {
		return [this.sourcePath, this.config.boards.join('+'), describeSwimlane(spec)].join('\n');
	}

	/** Swimlanes: one header line of lanes, then one row of cells for each value. A cell holds the cards of one lane in one row. */
	private renderSwim(parent: HTMLElement, view: EmbedView, spec: SwimlaneSpec): void {
		const rows = groupSwimlanes(view.columns, spec);
		const key = this.collapseKey(spec);
		const folded = new Set(this.plugin.settings.collapsedRows[key] ?? []);
		const wrap = parent.createDiv({ cls: 'kanban-embed-swim' });
		wrap.setCssProps({ '--kanban-embed-swim-cols': String(view.columns.length) });
		const head = wrap.createDiv({ cls: 'kanban-embed-swim-head' });
		for (const col of view.columns) {
			const h = head.createDiv({ cls: 'kanban-embed-lane-header', attr: { 'data-lane': col.title } });
			h.createSpan({ cls: 'kanban-embed-lane-title', text: col.title });
			const count = h.createSpan({ cls: 'kanban-embed-lane-count', text: col.maxItems > 0 ? `${col.total}/${col.maxItems}` : String(col.total) });
			if (col.maxItems > 0 && col.total > col.maxItems) count.addClass('mod-over');
		}
		for (const row of rows) this.renderRow(wrap, view, spec, row, key, folded);
		if (rows.length === 0) wrap.createDiv({ cls: 'kanban-embed-empty', text: 'No cards to put in rows.' });
	}

	private renderRow(wrap: HTMLElement, view: EmbedView, spec: SwimlaneSpec, row: SwimRow, key: string, folded: Set<string>): void {
		const rowEl = wrap.createDiv({ cls: 'kanban-embed-swim-row', attr: { 'data-row': row.title } });
		const btn = rowEl.createEl('button', { cls: 'kanban-embed-swim-row-head' });
		const icon = btn.createSpan({ cls: 'kanban-embed-swim-chevron' });
		btn.createSpan({ cls: 'kanban-embed-swim-row-title', text: row.title });
		btn.createSpan({ cls: 'kanban-embed-swim-row-count', text: String(row.count) });
		const show = (isFolded: boolean) => {
			rowEl.toggleClass('is-collapsed', isFolded);
			btn.setAttr('aria-expanded', String(!isFolded));
			btn.setAttr('aria-label', `${isFolded ? 'Expand' : 'Collapse'} the row ${row.title}`);
			setIcon(icon, isFolded ? 'chevron-right' : 'chevron-down');
		};
		show(folded.has(row.key));
		btn.addEventListener('click', () => {
			const next = !rowEl.hasClass('is-collapsed');
			show(next);
			if (next) folded.add(row.key);
			else folded.delete(row.key);
			void this.plugin.saveCollapsed(key, [...folded]);
		});
		const cells = rowEl.createDiv({ cls: 'kanban-embed-swim-cells' });
		view.columns.forEach((col, ci) => {
			const cards = row.cells[ci] ?? [];
			const cell = cells.createDiv({ cls: 'kanban-embed-swim-cell', attr: { 'data-lane': col.title, 'data-row': row.title } });
			if (col.complete) cell.addClass('mod-complete');
			const list = cell.createDiv({ cls: 'kanban-embed-cards' });
			for (const card of cards) this.renderCard(list, card, ci);
			if (cards.length === 0) list.createDiv({ cls: 'kanban-embed-empty', text: 'No cards' });
			this.bindRowDrop(list, col, row, cards, spec);
			this.renderAdd(cell, col, rowSuffix(spec, row));
		});
	}

	/** A drop in a cell moves the card to that lane, in front of the next card of the same row. Cards of another row are refused: the row comes from the card text. */
	private bindRowDrop(list: HTMLElement, col: ViewColumn, row: SwimRow, cards: ViewCard[], spec: SwimlaneSpec): void {
		const accepts = () => {
			const d = dragging;
			if (d === null || d.embed !== this || !col.targets.some((t) => t.board === d.card.board)) return false;
			return (rowOf(d.card, spec)?.key ?? UNASSIGNED_KEY) === row.key;
		};
		list.addEventListener('dragover', (evt) => {
			if (!accepts()) return;
			evt.preventDefault();
			list.addClass('is-drop-target');
		});
		list.addEventListener('dragleave', () => list.removeClass('is-drop-target'));
		list.addEventListener('drop', (evt) => {
			list.removeClass('is-drop-target');
			if (!accepts()) return;
			evt.preventDefault();
			const card = dragging!.card;
			const target = col.targets.find((t) => t.board === card.board)!;
			let above = 0;
			for (const el of Array.from(list.querySelectorAll<HTMLElement>('.kanban-embed-card'))) {
				const r = el.getBoundingClientRect();
				if (evt.clientY < r.top + r.height / 2) break;
				above++;
			}
			void this.plugin.move(this.boards[card.board]!.path, card, target.lane, dropIndex(cards, above, card.board, target.size));
		});
	}

	private renderCard(list: HTMLElement, card: ViewCard, colIndex: number): void {
		const board = this.boards[card.board]!;
		const el = list.createDiv({ cls: 'kanban-embed-card', attr: { 'data-line': String(card.line) } });
		if (card.checked) el.addClass('is-checked');
		if (card.priority) el.addClass(`mod-priority-${card.priority}`);
		if (card.checkChar !== null) {
			const box = el.createEl('input', { cls: 'task-list-item-checkbox kanban-embed-check', type: 'checkbox' });
			box.checked = card.checked;
			box.setAttr('aria-label', card.checked ? 'Mark as not done' : 'Mark as done');
			box.addEventListener('click', (evt) => evt.stopPropagation());
			box.addEventListener('change', () => void this.plugin.toggle(board.path, card, box.checked));
		}
		const body = el.createDiv({ cls: 'kanban-embed-card-body' });
		void MarkdownRenderer.render(this.plugin.app, card.title, body, board.path, this.cardsOwner ?? this);
		this.bindLinks(body, board.path);
		const more = el.createEl('button', { cls: 'clickable-icon kanban-embed-more', attr: { 'aria-label': 'Card actions' } });
		const chips: { cls: string; text: string }[] = [];
		const when = [card.date, card.time].filter((x): x is string => x !== null).join(' ');
		if (when !== '') chips.push({ cls: 'mod-date', text: when });
		if (card.priority) chips.push({ cls: `mod-priority-${card.priority}`, text: card.priority });
		if (this.boards.length > 1) chips.push({ cls: 'mod-board', text: board.name });
		if (chips.length > 0) {
			const meta = el.createDiv({ cls: 'kanban-embed-card-meta' });
			for (const c of chips) meta.createSpan({ cls: `kanban-embed-chip ${c.cls}`, text: c.text });
		}
		setIcon(more, 'more-horizontal');
		more.addEventListener('click', (evt) => this.cardMenu(evt, card, colIndex));
		el.addEventListener('contextmenu', (evt) => this.cardMenu(evt, card, colIndex));
		el.draggable = true;
		el.addEventListener('dragstart', (evt) => {
			dragging = { embed: this, card };
			evt.dataTransfer?.setData(DRAG_TYPE, String(card.line));
			evt.dataTransfer?.setData('text/plain', card.text);
			el.addClass('is-dragging');
		});
		el.addEventListener('dragend', () => {
			dragging = null;
			el.removeClass('is-dragging');
		});
	}

	/** Internal links inside a card open from the board file's folder, like in the board. */
	private bindLinks(body: HTMLElement, boardPath: string): void {
		body.addEventListener('click', (evt) => {
			const a = (evt.target as HTMLElement).closest('a.internal-link');
			if (!(a instanceof HTMLAnchorElement)) return;
			evt.preventDefault();
			const target = a.getAttr('data-href') ?? a.getAttr('href') ?? '';
			void this.plugin.app.workspace.openLinkText(target, boardPath, Keymap.isModEvent(evt));
		});
	}

	/** Card menu: open the board, and (Pro) move the card to another lane of the same board. */
	cardMenu(evt: MouseEvent, card: ViewCard, colIndex: number): void {
		evt.preventDefault();
		evt.stopPropagation();
		const board = this.boards[card.board]!;
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle('Open the board')
				.setIcon('square-kanban')
				.setSection('open')
				.onClick(() => void this.plugin.app.workspace.openLinkText(board.path, this.sourcePath, false)),
		);
		this.view?.columns.forEach((col, ci) => {
			const target = col.targets.find((t) => t.board === card.board);
			if (ci === colIndex || !target) return;
			menu.addItem((i) =>
				i
					.setTitle(`Move to ${col.title}`)
					.setIcon('arrow-right')
					.setSection('move')
					.onClick(() => void this.plugin.move(board.path, card, target.lane, target.size)),
			);
		});
		menu.showAtMouseEvent(evt);
	}

	private bindDrop(list: HTMLElement, col: ViewColumn): void {
		const accepts = () => dragging !== null && dragging.embed === this && col.targets.some((t) => t.board === dragging!.card.board);
		list.addEventListener('dragover', (evt) => {
			if (!accepts()) return;
			evt.preventDefault();
			list.addClass('is-drop-target');
		});
		list.addEventListener('dragleave', () => list.removeClass('is-drop-target'));
		list.addEventListener('drop', (evt) => {
			list.removeClass('is-drop-target');
			if (!accepts()) return;
			evt.preventDefault();
			const card = dragging!.card;
			const target = col.targets.find((t) => t.board === card.board)!;
			const before = this.cardBefore(list, col, evt.clientY, card.board);
			const index = before ? before.index : target.size;
			void this.plugin.move(this.boards[card.board]!.path, card, target.lane, index);
		});
	}

	/** The first card of the same board below the pointer, or null to drop at the end of the lane. */
	private cardBefore(list: HTMLElement, col: ViewColumn, y: number, board: number): ViewCard | null {
		const els = Array.from(list.querySelectorAll<HTMLElement>('.kanban-embed-card'));
		for (let i = 0; i < els.length && i < col.cards.length; i++) {
			const r = els[i]!.getBoundingClientRect();
			const c = col.cards[i]!;
			if (y < r.top + r.height / 2 && c.board === board) return c;
		}
		return null;
	}

	/** The add card button of a lane or a swimlane cell. `suffix` goes behind the typed text, so a card added in a row is in that row. */
	private renderAdd(lane: HTMLElement, col: ViewColumn, suffix = ''): void {
		const target = col.targets[0];
		if (!target) return;
		const btn = lane.createEl('button', { cls: 'kanban-embed-add', text: 'Add a card' });
		btn.addEventListener('click', () => {
			if (!isPro()) return BoardEmbed.needsPro('Adding cards');
			btn.hide();
			this.adding = true;
			const input = lane.createEl('input', { cls: 'kanban-embed-add-input', type: 'text', attr: { placeholder: 'New card text' } });
			input.focus();
			const close = () => {
				this.adding = false;
				input.remove();
				btn.show();
			};
			input.addEventListener('keydown', (evt) => {
				if (evt.key === 'Escape') close();
				if (evt.key !== 'Enter') return;
				evt.preventDefault();
				const text = input.value;
				close();
				void this.plugin.add(this.boards[target.board]!.path, target.lane, text.trim() === '' ? text : `${text.trim()}${suffix}`);
			});
			input.addEventListener('blur', () => window.setTimeout(close, 150));
		});
	}

	static needsPro(feature: string): void {
		proNotice(`${feature} is a pro feature.`);
	}
}
