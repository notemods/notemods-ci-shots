import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import type { Editor } from 'obsidian';
import EpochNoteConverterPlugin from '../src/main';
import { DEFAULT_SETTINGS, EpochNoteConverterSettingTab, normalizeSettings } from '../src/settings';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { applyEdit, snapshot } from '../src/edit';
import { column, convert, validFormat } from '../src/converter';
import manifest from '../manifest.json';

afterEach(() => resetPro());

function fakeManager(start: boolean) {
	let pro = start;
	const listeners = new Set<() => void>();
	return {
		isPro: () => pro,
		onChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
		set(value: boolean) { pro = value; for (const cb of listeners) cb(); },
		listeners,
	};
}

function editorStub() {
	let text = 'Before 1000 after';
	let from = { line: 0, ch: 7 };
	let to = { line: 0, ch: 11 };
	const transaction = vi.fn((tx: { changes: { from: { ch: number }; to: { ch: number }; text: string }[] }) => {
		const change = tx.changes[0]!;
		text = text.slice(0, change.from.ch) + change.text + text.slice(change.to.ch);
	});
	return {
		getSelection: () => text.slice(from.ch, to.ch), getValue: () => text,
		getCursor: (side: string) => side === 'from' ? from : to,
		listSelections: () => [{ anchor: from, head: to }], transaction,
		setValue: (v: string) => { text = v; },
		setSelection: (a: typeof from, h: typeof to) => { from = a; to = h; },
	};
}

describe('settings and sponsor state', () => {
	it('loads defaults in a vault and keeps free use signed out', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '1000' } });
		const plugin = new EpochNoteConverterPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});
	it('repairs malformed settings, removes unsupported zones and bounds the list', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ format: 'no offset', zones: 'UTC, UTC, Bad/Place, Asia/Bangkok' })).toEqual({ zones: 'UTC, Asia/Bangkok', format: '{date}T{time}{offset}' });
		expect(normalizeSettings({ format: 4 as never, zones: 8 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ zones: 'UTC, Asia/Bangkok, Europe/London, Europe/Paris, Asia/Tokyo, America/New_York, America/Chicago' }).zones.split(', ')).toHaveLength(6);
	});
	it('blocks Pro settings persistence while signed out', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new EpochNoteConverterPlugin(app as never, manifest as never);
		const save = vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
		const tab = new EpochNoteConverterSettingTab(app as never, plugin);
		await tab.setControlValue('format', '{date} {time} {offset}');
		expect(save).not.toHaveBeenCalled();
		bindPro(fakeManager(true) as never);
		await tab.setControlValue('format', '{date} {time} {offset}');
		expect(plugin.settings.format).toBe('{date} {time} {offset}');
		expect(save).toHaveBeenCalledOnce();
	});
	it('blocks a column command before it opens a preview', () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new EpochNoteConverterPlugin(app as never, manifest as never);
		plugin.openConverter(editorStub() as unknown as Editor, true);
		expect(plugin.previews.size).toBe(0);
	});
	it('matches the sponsor terms and follows sign out', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0 });
		const manager = fakeManager(true);
		bindPro(manager as never);
		const cb = vi.fn();
		const off = onProChange(cb);
		expect(isPro()).toBe(true);
		manager.set(false);
		expect(isPro()).toBe(false);
		expect(cb).toHaveBeenCalledOnce();
		off(); resetPro();
		expect(manager.listeners.size).toBe(0);
	});
});

describe('editor safety', () => {
	it('uses one transaction for replace and preserves the surrounding text', () => {
		const editor = editorStub();
		expect(applyEdit(editor as unknown as Editor, snapshot(editor as unknown as Editor), '1970-01-01T00:00:01.000Z', 'replace')).toBe(true);
		expect(editor.transaction).toHaveBeenCalledOnce();
		expect(editor.getValue()).toBe('Before 1970-01-01T00:00:01.000Z after');
	});
	it('inserts beside the original in one transaction', () => {
		const editor = editorStub();
		expect(applyEdit(editor as unknown as Editor, snapshot(editor as unknown as Editor), '1970-01-01T00:00:01.000Z', 'insert')).toBe(true);
		expect(editor.getValue()).toBe('Before 1000 → 1970-01-01T00:00:01.000Z after');
		expect(editor.transaction).toHaveBeenCalledOnce();
	});
	it.each(['source', 'outside', 'selection'])('refuses a stale %s with no transaction', (change) => {
		const editor = editorStub();
		const saved = snapshot(editor as unknown as Editor);
		if (change === 'source') editor.setValue('Before 2000 after');
		if (change === 'outside') editor.setValue('Before 1000 edited');
		if (change === 'selection') editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 6 });
		expect(applyEdit(editor as unknown as Editor, saved, 'result', 'replace')).toBe(false);
		expect(editor.transaction).not.toHaveBeenCalled();
	});
	it('refuses multiple cursors', () => {
		const editor = editorStub();
		const saved = snapshot(editor as unknown as Editor);
		editor.listSelections = () => [{ anchor: saved.from, head: saved.to }, { anchor: saved.from, head: saved.to }];
		expect(applyEdit(editor as unknown as Editor, saved, 'result', 'replace')).toBe(false);
	});
});

describe('local clock and format safety', () => {
	it('uses device-local output with its numeric offset', () => {
		const d = new Date(1704067200000);
		const got = convert('1704067200', 'seconds', 'local');
		expect(got.ok).toBe(true);
		if (!got.ok) return;
		expect(got.value).toContain(`T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
		expect(got.value).toMatch(/[+-]\d{2}:\d{2}$/);
	});
	it.each(['{date}{time}', '{date}{date}{time}{offset}', '{date}{time}{offset}{unknown}', '{date}\n{time}{offset}', 'x'.repeat(121)])('rejects unsafe format %s', (format) => {
		expect(validFormat(format)).toBe(false);
		expect(convert('0', 'seconds', 'utc', format).ok).toBe(false);
	});
	it('validates the whole column before it returns output', () => {
		expect(column('0\nabc\n1000', 'seconds')).toMatchObject({ ok: false });
		expect(column(Array(501).fill('0').join('\n'), 'seconds')).toMatchObject({ ok: false });
		expect(column(Array(500).fill('0').join('\n'), 'seconds').ok).toBe(true);
	});
});
