import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type EpochNoteConverterPlugin from '../../src/main';
import { pluginId } from './load';

type PluginApp = { plugins: { plugins: Record<string, EpochNoteConverterPlugin> } };
const modal = '.epoch-converter-modal';

async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, value) => {
		const p = (app as unknown as PluginApp).plugins.plugins[id]!;
		if (!value) { p.pro!.signOut(); return; }
		const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
		(p.pro as unknown as { opts: { http: unknown } }).opts.http = () => Promise.resolve(reply);
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await p.pro!.refreshNow();
	}, pluginId, on);
}

async function prepare(text: string, selected: string, command = 'convert-selection'): Promise<void> {
	await obsidianPage.write('Conversion.md', text);
	await obsidianPage.openFile('Conversion.md');
	await browser.waitUntil(async () => browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.file?.path === 'Conversion.md'), { timeout: 30000 });
	await browser.executeObsidian(async ({ app, obsidian }, text, selected) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
		await view.setState({ mode: 'source', source: true }, { history: false });
		const editor = view.editor;
		editor.setValue(text);
		const start = text.indexOf(selected);
		editor.setSelection(editor.offsetToPos(start), editor.offsetToPos(start + selected.length));
		editor.focus();
	}, text, selected);
	await browser.executeObsidianCommand(`${pluginId}:${command}`);
}

async function text(): Promise<string> {
	return browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.getValue());
}

async function choose(unit: string, zone = 'utc'): Promise<void> {
	const row = await browser.$(`${modal} [data-unit="${unit}"][data-zone="${zone}"]`);
	await row.waitForExist({ timeout: 30000 });
	// DOM activation avoids scroll position and modal animation races on Linux.
	await browser.execute((unit, zone) => {
		const button = document.querySelector<HTMLButtonElement>(`.epoch-converter-modal [data-unit="${unit}"][data-zone="${zone}"] button`);
		if (!button || button.disabled) throw new Error('Choice is not enabled');
		button.click();
	}, unit, zone);
	await browser.waitUntil(async () => (await browser.$(`${modal} .epoch-chosen`).getText()).includes(`Chosen: ${unit} · ${zone}`), { timeout: 30000 });
}

async function apply(label = 'Replace selection'): Promise<void> {
	await browser.execute((label) => {
		const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.epoch-converter-modal .epoch-actions button'));
		const button = buttons.find((b) => b.textContent === label);
		if (!button || button.disabled) throw new Error('Apply is not enabled');
		button.click();
	}, label);
	await browser.$(modal).waitForExist({ reverse: true, timeout: 30000 });
}

describe('selection conversion in the real editor', function () {
	beforeEach(async function () { await setPro(false); });
	afterEach(async function () {
		await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as PluginApp).plugins.plugins[id]!;
			for (const preview of p.previews) preview.close();
			p.pro!.signOut();
		}, pluginId);
	});

	it('labels both interpretations and requires a choice', async function () {
		await prepare('Before 1000 after', '1000');
		await browser.$(modal).waitForExist({ timeout: 30000 });
		expect(await browser.$(`${modal} [data-unit="seconds"][data-zone="utc"]`).getText()).toContain('1970-01-01T00:16:40.000Z');
		expect(await browser.$(`${modal} [data-unit="milliseconds"][data-zone="utc"]`).getText()).toContain('1970-01-01T00:00:01.000Z');
		const disabled = await browser.execute(() => Array.from(document.querySelectorAll<HTMLButtonElement>('.epoch-actions button')).filter((b) => b.textContent !== 'Cancel').map((b) => b.disabled));
		expect(disabled).toEqual([true, true]);
		expect(await text()).toBe('Before 1000 after');
	});

	for (const [input, unit, output] of [
		['0', 'seconds', '1970-01-01T00:00:00.000Z'],
		['-1', 'seconds', '1969-12-31T23:59:59.000Z'],
		['1704067200', 'seconds', '2024-01-01T00:00:00.000Z'],
		['1704067200000', 'milliseconds', '2024-01-01T00:00:00.000Z'],
	]) it(`replaces ${input} as ${unit} and restores it with one undo`, async function () {
		const original = `Before ${input} after`;
		await prepare(original, input);
		await choose(unit); await apply();
		expect(await text()).toBe(`Before ${output} after`);
		await browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.undo());
		expect(await text()).toBe(original);
	});

	it('inserts beside the exact original selection', async function () {
		await prepare('Before 1000 after', '1000');
		await choose('milliseconds'); await apply('Insert beside original');
		expect(await text()).toBe('Before 1000 → 1970-01-01T00:00:01.000Z after');
	});

	it('shows device-local time with a numeric offset', async function () {
		await prepare('1704067200', '1704067200');
		await choose('seconds', 'local'); await apply();
		const expected = await browser.execute(() => {
			const d = new Date(1704067200000);
			const p = (n: number, width = 2) => String(n).padStart(width, '0');
			const offset = -d.getTimezoneOffset();
			return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.000${offset < 0 ? '-' : '+'}${p(Math.floor(Math.abs(offset) / 60))}:${p(Math.abs(offset) % 60)}`;
		});
		expect(await text()).toBe(expected);
	});

	for (const input of ['1.5', '1e3', 'abc', '8640000000000001']) it(`refuses ${input} without a note edit`, async function () {
		await prepare(`Before ${input} after`, input);
		await browser.$(modal).waitForExist({ timeout: 30000 });
		expect(await browser.$(`${modal} .epoch-error`).isExisting()).toBe(true);
		const disabled = await browser.execute(() => Array.from(document.querySelectorAll<HTMLButtonElement>('.epoch-result button')).map((b) => b.disabled));
		expect(disabled).toEqual([true, true, true, true]);
		expect(await text()).toBe(`Before ${input} after`);
	});

	it('refuses a stale source after preview opens', async function () {
		await prepare('Before 1000 after', '1000');
		await choose('seconds');
		await browser.executeObsidian(({ app, obsidian }) => {
			const e = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
			e.replaceRange('2000', { line: 0, ch: 7 }, { line: 0, ch: 11 });
			e.setSelection({ line: 0, ch: 7 }, { line: 0, ch: 11 });
		});
		await apply();
		expect(await text()).toBe('Before 2000 after');
	});

	it('gates the column command when signed out', async function () {
		await prepare('0\n-1', '0\n-1', 'convert-column');
		expect(await browser.$(modal).isExisting()).toBe(false);
		expect(await text()).toBe('0\n-1');
	});

	it('converts a Pro column in one undo step using a stubbed sponsorship', async function () {
		await setPro(true);
		await prepare('Log\n0\n-1\nEnd', '0\n-1', 'convert-column');
		await choose('seconds'); await apply();
		expect(await text()).toBe('Log\n1970-01-01T00:00:00.000Z\n1969-12-31T23:59:59.000Z\nEnd');
		await browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.undo());
		expect(await text()).toBe('Log\n0\n-1\nEnd');
	});

	it('compares saved zones and uses the saved technical format', async function () {
		await setPro(true);
		await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as PluginApp).plugins.plugins[id]!;
			p.settings = { zones: 'Asia/Bangkok', format: '{date} {time} {offset}' };
		}, pluginId);
		await prepare('1704067200', '1704067200');
		await choose('seconds', 'Asia/Bangkok');
		expect(await browser.$(`${modal} [data-unit="seconds"][data-zone="Asia/Bangkok"]`).getText()).toContain('2024-01-01T07:00:00.000+07:00');
		await browser.execute(() => {
			const select = document.querySelector<HTMLSelectElement>('.epoch-converter-modal select')!;
			select.value = 'saved'; select.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await apply();
		expect(await text()).toBe('2024-01-01 07:00:00.000 +07:00');
	});

	it('revokes a Pro preview when the account signs out', async function () {
		await setPro(true);
		await prepare('0\n-1', '0\n-1', 'convert-column');
		await choose('seconds');
		await setPro(false);
		expect(await browser.$(`${modal} .epoch-chosen`).getText()).toContain('No result chosen');
		expect(await text()).toBe('0\n-1');
	});
});
