import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import TableRowLinksPlugin from '../src/main';
import { bindPro, isPro, resetPro, SPONSORS } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => { resetPro(); vi.restoreAllMocks(); });
function editor(text: string) {
	let value = text;
	return { getValue: () => value, getCursor: () => ({ line: 2, ch: 2 }), setLine: vi.fn((line: number, s: string) => { const a = value.split('\n'); a[line] = s; value = a.join('\n'); }), setValue: vi.fn((s: string) => { value = s; }) };
}
const TABLE = '| Fruit | Count |\n|---|---|\n| Apples | 3 |\nTail';

describe('copy action', () => {
	it('changes one line, reuses the marker and writes an encoded link', async () => {
		const app = App.createConfigured__({ files: { 'Notes/Fruit #1.md': TABLE } });
		const p = new TableRowLinksPlugin(app as never, manifest as never);
		const e = editor(TABLE);
		const write = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
		const file = app.vault.getAbstractFileByPath('Notes/Fruit #1.md')!;
		await p.copyRowLink(e as never, file as never);
		expect(e.setLine).toHaveBeenCalledTimes(1);
		expect(e.getValue().split('\n')[3]).toBe('Tail');
		expect(write.mock.calls[0]![0]).toContain('file=Notes%2FFruit%20%231.md');
		await p.copyRowLink(e as never, file as never);
		expect(e.setLine).toHaveBeenCalledTimes(1);
		expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
	});

	it('clipboard rejection does not reject the action or remove the anchor', async () => {
		const app = App.createConfigured__({ files: { 'Fruit.md': TABLE } });
		const p = new TableRowLinksPlugin(app as never, manifest as never);
		const e = editor(TABLE);
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
		await expect(p.copyRowLink(e as never, app.vault.getAbstractFileByPath('Fruit.md') as never)).resolves.toBeUndefined();
		expect(e.getValue()).toMatch(/%%row:[a-z0-9]{6}%%/);
	});
});

describe('Sponsors gate', () => {
	it('uses the reference terms and disables direct Pro actions when signed out', async () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user', sponsorLogin: 'theluckystrike' });
		const app = App.createConfigured__({ files: { 'Fruit.md': TABLE } });
		const p = new TableRowLinksPlugin(app as never, manifest as never);
		const read = vi.spyOn(app.vault, 'cachedRead');
		await p.searchVault();
		const e = editor(TABLE);
		await p.removeUnused(e as never, app.vault.getAbstractFileByPath("Fruit.md") as never);
		expect(read).not.toHaveBeenCalled();
		expect(e.setValue).not.toHaveBeenCalled();
	});

	it('facade follows the manager and reset removes its listener', () => {
		let active = true;
		const off = vi.fn();
		bindPro({ isPro: () => active, onChange: () => off } as never);
		expect(isPro()).toBe(true);
		active = false;
		expect(isPro()).toBe(false);
		resetPro();
		expect(off).toHaveBeenCalledOnce();
		expect(isPro()).toBe(false);
	});
});
