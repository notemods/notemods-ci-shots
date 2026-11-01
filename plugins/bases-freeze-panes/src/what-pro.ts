// "What Pro adds" for this plugin: the Pro lines of pro-features.ts, each with a demo that runs the real column planner
// and the real settings rules on a sample table in the window. A demo never reads or writes a vault file and never
// turns Pro on for a real table.
import type { App } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { demoText, showWhatProAdds, type WhatProDemoFeature, type WhatProModal } from './license/github-obsidian';
import { planRow } from './layout';
import { PRO_FEATURES } from './pro-features';
import { PRO_UI, SPONSORS } from './pro';
import { DEFAULT_SETTINGS, effectiveFor, withFileChoice, withViewChoice } from './scope';

export const SAMPLE_COLUMNS = ['Name', 'Author', 'Year', 'Pages', 'Genre', 'Rating', 'Shelf', 'Status'];
const WIDTHS = [150, 130, 70, 70, 110, 80, 100, 100];
const SAMPLE_ROWS = [
	['Deep Work', 'Cal Newport', '2016', '296', 'Work', '4', 'Office', 'Read'],
	['Dune', 'Frank Herbert', '1965', '412', 'Science fiction', '5', 'Living room', 'Read'],
	['Middlemarch', 'George Eliot', '1871', '880', 'Novel', '4', 'Bedroom', 'Reading'],
	['The Overstory', 'Richard Powers', '2018', '502', 'Novel', '5', 'Office', 'To read'],
	['Thinking in Systems', 'Donella Meadows', '2008', '240', 'Science', '4', 'Office', 'Read'],
];

export interface TableDemo {
	frozen: string[];
	end: string | null;
	order: string[];
}

/**
 * Draws the sample table with the plan of the plugin (planRow): frozen columns stick to the left edge, the pinned
 * last column sticks to the right edge, and a pinned property moves next to the frozen columns.
 */
export function tableDemo(el: HTMLElement, frozen: number, pinLast: boolean, pinIndex: number | null): TableDemo {
	const plan = planRow(WIDTHS, frozen, 0, Number.MAX_SAFE_INTEGER, pinLast, pinIndex);
	if (!plan) throw new Error('the sample widths are not usable');
	const order = [...plan.cells].sort((a, b) => a.start - b.start);
	const result: TableDemo = {
		frozen: order.filter((c) => c.frozen).map((c) => SAMPLE_COLUMNS[c.index] ?? ''),
		end: plan.end === null ? null : (SAMPLE_COLUMNS[plan.end] ?? null),
		order: order.map((c) => SAMPLE_COLUMNS[c.index] ?? ''),
	};
	el.createEl('p', { text: 'Scroll the sample table sideways.', cls: 'pf-whatpro-demo-label' });
	const wrap = el.createDiv({ cls: 'pf-whatpro-table-wrap' });
	wrap.setCssStyles({ overflowX: 'auto', maxWidth: '100%', border: '1px solid var(--background-modifier-border)' });
	const table = wrap.createEl('table', { cls: 'pf-whatpro-table' });
	table.setCssStyles({ borderCollapse: 'separate', borderSpacing: '0', tableLayout: 'fixed', width: `${WIDTHS.reduce((s, w) => s + w, 0)}px`, margin: '0' });
	const drawRow = (cells: string[], tag: 'th' | 'td'): void => {
		const tr = table.createEl('tr');
		for (const c of order) {
			const cell = tr.createEl(tag, { text: cells[c.index] ?? '' });
			cell.setCssStyles({ width: `${c.width}px`, padding: '4px 8px', whiteSpace: 'nowrap', overflow: 'hidden', backgroundColor: 'var(--background-primary)' });
			if (c.frozen) {
				cell.addClass('is-frozen');
				cell.setCssStyles({ position: 'sticky', left: `${c.start}px`, zIndex: '1', backgroundColor: 'var(--background-secondary)' });
			} else if (c.index === plan.end) {
				cell.addClass('is-end');
				cell.setCssStyles({ position: 'sticky', right: '0', zIndex: '1', backgroundColor: 'var(--background-secondary)' });
			}
		}
	};
	drawRow(SAMPLE_COLUMNS, 'th');
	for (const row of SAMPLE_ROWS) drawRow(row, 'td');
	const parts = [`Frozen on the left: ${result.frozen.join(', ') || 'none'}.`];
	if (result.end) parts.push(`Pinned to the right edge: ${result.end}.`);
	el.createEl('p', { text: parts.join(' '), cls: 'pf-whatpro-demo-result' });
	return result;
}

const DEMOS: Record<string, (el: HTMLElement) => void> = {
	columns: (el) => {
		tableDemo(el, 3, false, null);
	},
	'file-view': (el) => {
		let s = withFileChoice(DEFAULT_SETTINGS, 'Books.base', { columns: 3 });
		s = withViewChoice(s, 'Books.base', 'By shelf', { columns: 2 });
		const rows = [
			`Books.base, view Table: ${effectiveFor(s, 'Books.base', true, 'Table').columns} frozen columns`,
			`Books.base, view By shelf: ${effectiveFor(s, 'Books.base', true, 'By shelf').columns} frozen columns`,
			`Other files: ${effectiveFor(s, 'Reading.base', true, 'Table').columns} frozen column`,
		];
		demoText(el, 'Sample choices for one file and one view, and the result:', rows.join('\n'));
	},
	last: (el) => {
		tableDemo(el, 1, true, null);
	},
	pin: (el) => {
		tableDemo(el, 1, false, SAMPLE_COLUMNS.indexOf('Rating'));
	},
};

export function whatProFeatures(): WhatProDemoFeature[] {
	return PRO_FEATURES.map((f) => ({ ...f, demo: DEMOS[f.id] ?? ((el: HTMLElement) => void el.createEl('p', { text: f.line })) }));
}

export function openWhatPro(app: App, pro: SponsorsManager | null, pluginId: string, pluginName: string): WhatProModal {
	return showWhatProAdds(app, pro, { pluginId, pluginName, features: whatProFeatures(), priceText: PRO_UI.priceText }, SPONSORS);
}
