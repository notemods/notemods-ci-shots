import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import TableRowLinksPlugin from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import { rowLabel } from '../src/rows';
import manifest from '../manifest.json';

afterEach(() => { resetPro(); vi.restoreAllMocks(); });

const MARKED = '| Fruit | Count |\n|---|---|\n| Apples %%row:abc123%% | 3 |\n| Pears %%row:def456%% | 2 |\n| Plums %%row:ghi789%% | 1 |';

function editor(text: string) {
	let value = text;
	return { getValue: () => value, setValue: vi.fn((s: string) => { value = s; }) };
}

describe('cleanup keeps URI references with text after the row id', () => {
	it('keeps anchors that a bare URI before punctuation and an HTML link reference', async () => {
		const review = [
			'See obsidian://table-row?vault=V&file=Fruit.md&row=abc123.',
			'<a href="obsidian://table-row?vault=V&amp;file=Fruit.md&amp;row=def456">Pears</a>',
		].join('\n');
		const app = App.createConfigured__({ files: { 'Fruit.md': MARKED, 'Review.md': review } });
		vi.spyOn(app.vault, 'getName').mockReturnValue('V');
		const p = new TableRowLinksPlugin(app as never, manifest as never);
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const e = editor(MARKED);
		await p.removeUnused(e as never, app.vault.getAbstractFileByPath('Fruit.md') as never);
		expect(e.getValue()).toContain('%%row:abc123%%');
		expect(e.getValue()).toContain('%%row:def456%%');
		expect(e.getValue()).not.toContain('%%row:ghi789%%');
	});
});

describe('row labels', () => {
	it('does not split a character outside the Basic Multilingual Plane at the 40 character limit', () => {
		const label = rowLabel(`| ${'a'.repeat(39)}🍎 rest |`, 1);
		expect(label).toBe(`${'a'.repeat(39)}🍎`);
	});
});
