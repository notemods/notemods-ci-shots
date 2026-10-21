import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import QueryPlugin from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import { normalizeSettings } from '../src/settings';
import { parseInput, report } from '../src/query';
import { QueryView } from '../src/view';
import manifest from '../manifest.json';

function plugin(files: Record<string, string> = {}) {
	const app = App.createConfigured__({ files });
	return new QueryPlugin(app as never, manifest as never);
}
function pro(on: boolean) { bindPro({ isPro: () => on, onChange: () => () => undefined } as never); }
afterEach(resetPro);
describe('vault and UI boundaries', () => {
	it('saves and restores Adults from persisted settings', async () => {
		const p = plugin();
		await p.saveQuery({ name: 'Adults', path: 'people.json', expression: 'rows[?age > `25`].name' });
		const data = await p.loadData();
		const reloaded = plugin();
		reloaded.settings = normalizeSettings(data);
		const v = Object.create(QueryView.prototype) as QueryView;
		Object.assign(v, { owner: reloaded, revision: 0, draw: vi.fn() });
		v.selectSaved('Adults');
		expect(v.path).toBe('people.json'); expect(v.expression).toBe('rows[?age > `25`].name');
	});
	it('free queries read one file', async () => {
		const p = plugin({ 'a.json': '{"n":3}' });
		await expect(p.queryFile('a.json', 'n')).resolves.toBe(3);
	});
	it('free state blocks batch and report writes', async () => {
		const p = plugin(); const create = vi.spyOn(p.app.vault, 'create');
		await expect(p.queryFiles(['a.json'], '@')).rejects.toThrow('Pro');
		await expect(p.writeReport(3, 'csv', 'Report')).rejects.toThrow('Pro');
		expect(create).not.toHaveBeenCalled();
	});
	it('Pro combines files and creates a complete report', async () => {
		pro(true); const p = plugin({ 'a.json': '[{"n":1}]', 'b.json': '[{"n":2}]' });
		const result = await p.queryFiles(['a.json', 'b.json'], '@');
		expect(result).toEqual([{ n: 1 }, { n: 2 }]);
		const f = await p.writeReport(result, 'csv', 'Report');
		expect(await p.app.vault.read(f)).toBe('"n"\r\n"1"\r\n"2"\r\n');
	});
	it('failed batch rejects without a partial result or write', async () => {
		pro(true); const p = plugin({ 'a.json': '[1]', 'b.json': 'broken' }); const create = vi.spyOn(p.app.vault, 'create');
		await expect(p.queryFiles(['a.json', 'b.json'], '@')).rejects.toThrow('JSON');
		expect(create).not.toHaveBeenCalled();
	});
	it('existing reports and invalid names are refused', async () => {
		pro(true); const p = plugin({ 'Report.csv': 'keep' });
		await expect(p.writeReport(3, 'csv', 'Report')).rejects.toThrow('exists');
		await expect(p.writeReport(3, 'csv', '../Report')).rejects.toThrow('path characters');
		expect(await p.app.vault.read(p.app.vault.getFileByPath('Report.csv')!)).toBe('keep');
	});
	it('malformed query cannot write a report from an old result', async () => {
		pro(true); const p = plugin({ 'a.json': '[1]' });
		const v = Object.create(QueryView.prototype) as QueryView;
		Object.assign(v, { owner: p, path: 'a.json', expression: '[', result: [9], revision: 0, output: createDiv() });
		await v.run(); expect(v.result).toBeUndefined();
		const create = vi.spyOn(p.app.vault, 'create');
		await expect(v.exportResult('csv', 'Bad')).resolves.toBeNull();
		expect(create).not.toHaveBeenCalled();
	});
	it('markup is text in a table, with no image or script node', () => {
		const v = Object.create(QueryView.prototype) as QueryView;
		const output = createDiv();
		Object.assign(v, { output, result: [{ value: '<img src=x onerror=alert(1)><script>bad</script>' }], error: '' });
		v.renderResult(); expect(output.querySelector('td')?.textContent).toContain('<img');
		expect(output.querySelector('img, script')).toBeNull();
	});
	it('a stale read cannot replace the new expression result', async () => {
		const p = plugin(); let resolve!: (v: unknown) => void;
		vi.spyOn(p, 'queryFile').mockImplementation(() => new Promise((r) => { resolve = r; }));
		const v = Object.create(QueryView.prototype) as QueryView;
		Object.assign(v, { owner: p, path: 'a.json', expression: '@', revision: 0, output: createDiv() });
		const running = v.run(); v.clearResult(); resolve(3); await running;
		expect(v.result).toBeUndefined();
	});
	it('copies the complete result when the display has 500 rows', async () => {
		const v = Object.create(QueryView.prototype) as QueryView;
		const result = Array.from({ length: 1000 }, (_, id) => ({ id }));
		const writeText = vi.fn(async (_text: string) => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		try {
			Object.assign(v, { result, error: '', output: createDiv() });
			v.renderResult(); await v.copy();
			expect(JSON.parse(writeText.mock.calls[0]![0] as string)).toHaveLength(1000);
		} finally { vi.unstubAllGlobals(); }
	});
	it('bad saved settings are removed', () => {
		expect(normalizeSettings({ saved: [null, 3, { name: 'x' }] })).toEqual({ saved: [] });
	});
});
describe('report and input fidelity', () => {
	it('CSV keeps negative numbers as numbers and still protects negative text', () => {
		expect(report([{ n: -5, s: '-x' }], 'csv')).toBe('"n","s"\r\n"-5","\'-x"\r\n');
	});
	it('Markdown keeps one table row for a lone CR and makes no tag or comment', () => {
		expect(report([{ a: 'x\ry', b: '#tag %%c%%' }], 'md')).toBe('| a | b |\n| --- | --- |\n| x<br>y | &#35;tag &#37;&#37;c&#37;&#37; |\n');
	});
	it('a UTF-8 byte order mark does not stop JSON or JSONL input', () => {
		expect(parseInput('\uFEFF{"a":1}', 'a.json')).toEqual({ a: 1 });
		expect(parseInput('\uFEFF{"a":1}\n{"a":2}', 'a.jsonl')).toEqual([{ a: 1 }, { a: 2 }]);
	});
});
