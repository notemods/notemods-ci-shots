import { afterEach, describe, expect, it, vi } from 'vitest';
import PocketNoteQuizPlugin from '../src/main';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { normalizeSettings } from '../src/settings';
import { parseQuestions, type Response } from '../src/quiz';

afterEach(() => resetPro());
function manager(enabled: boolean) {
	const listeners = new Set<() => void>();
	const m = { isPro: () => enabled, getState: () => ({ status: 'signed-out', lastAttemptAt: 0 }), hasToken: () => false, config: { sponsorLogin: 'theluckystrike' }, onChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); }, set: (v: boolean) => { enabled = v; listeners.forEach((fn) => fn()); } };
	bindPro(m as never); return m;
}
function fixture(files: Record<string, string> = { 'Study/a.md': 'A?\na\n\nB?\nb' }) {
	const texts = new Map(Object.entries(files));
	const file = (path: string) => texts.has(path) ? { path, extension: 'md' } : null;
	const vault = {
		getFileByPath: file, getAbstractFileByPath: file,
		getFolderByPath: (path: string) => path === 'Study' ? { path } : null,
		getMarkdownFiles: () => [...texts.keys()].map((p) => file(p)),
		read: vi.fn(async (f: { path: string }) => texts.get(f.path)!),
		process: vi.fn(async (f: { path: string }, fn: (s: string) => string) => { const s = fn(texts.get(f.path)!); texts.set(f.path, s); return s; }),
		create: vi.fn(async (path: string, text: string) => { if (texts.has(path)) throw new Error('exists'); texts.set(path, text); return file(path); }),
	};
	const plugin = Object.create(PocketNoteQuizPlugin.prototype) as PocketNoteQuizPlugin;
	const workspace = { getActiveFile: () => file('Study/a.md') };
	Object.assign(plugin, { app: { vault, workspace }, settings: normalizeSettings(null) });
	vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
	return { plugin, texts, vault };
}
function responses(text: string, path = 'Study/a.md'): Response[] { return parseQuestions(text, '?', path).map((c, i) => ({ ...c, result: i === 0 ? 'correct' : 'wrong' })); }

describe('plugin actions', () => {
	it('current-note quiz is free', async () => {
		const { plugin, vault } = fixture(); const open = vi.spyOn(plugin, 'openQuiz').mockImplementation(() => undefined);
		await plugin.startCurrent(); expect(vault.read).toHaveBeenCalledTimes(1); expect(open.mock.calls[0]![0]).toHaveLength(2); expect(isPro()).toBe(false);
	});
	it('Pro actions do no read or write while signed out', async () => {
		const { plugin, vault } = fixture();
		await plugin.startFolder('Study'); expect(await plugin.saveReport([])).toBeNull();
		expect(await plugin.addPreset('exam', 'Q:')).toBe(false); expect(await plugin.usePreset('exam')).toBe(false);
		expect(vault.read).not.toHaveBeenCalled(); expect(vault.create).not.toHaveBeenCalled(); expect(plugin.settings.presets).toEqual([]);
	});
	it('folder quizzes include descendants and exclude prefix siblings', async () => {
		manager(true); const { plugin } = fixture({ 'Study/a.md': 'A?\na', 'Study/sub/b.md': 'B?\nb', 'Study-extra/c.md': 'C?\nc' });
		const open = vi.spyOn(plugin, 'openQuiz').mockImplementation(() => undefined);
		await plugin.startFolder('Study'); expect(open.mock.calls[0]![0].map((c) => c.path)).toEqual(['Study/a.md', 'Study/sub/b.md']);
	});
	it('folder action rechecks Pro after reads', async () => {
		const m = manager(true); const { plugin, vault } = fixture(); const open = vi.spyOn(plugin, 'openQuiz').mockImplementation(() => undefined);
		vault.read.mockImplementation(async () => { m.set(false); return 'A?\na'; }); await plugin.startFolder('Study'); expect(open).not.toHaveBeenCalled();
	});
	it('apply compares current source within Vault.process', async () => {
		const { plugin, vault, texts } = fixture(); const r = responses(texts.get('Study/a.md')!);
		texts.set('Study/a.md', 'A?\na\n\nChanged?\nb');
		expect(await plugin.apply(r, '?')).toEqual({ applied: 1, skipped: 1 }); expect(vault.process).toHaveBeenCalledTimes(1);
		expect(texts.get('Study/a.md')).toBe('A?✅\na\n\nChanged?\nb');
	});
	it('a deleted file skips its cards', async () => {
		const { plugin, texts } = fixture(); const r = responses(texts.get('Study/a.md')!); texts.delete('Study/a.md');
		expect(await plugin.apply(r, '?')).toEqual({ applied: 0, skipped: 2 });
	});
	it('clear is free and keeps answer marks', async () => {
		const { plugin, texts } = fixture({ 'Study/a.md': 'A?✅\r\nAnswer ❌\r\n' });
		await plugin.clear(['Study/a.md'], '?'); expect(texts.get('Study/a.md')).toBe('A?\r\nAnswer ❌\r\n');
	});
	it('reports use new names when a dated path exists', async () => {
		manager(true); const { plugin, texts } = fixture(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T08:00:00Z'));
		try { const a = await plugin.saveReport(responses(texts.get('Study/a.md')!)); const b = await plugin.saveReport([]); expect(a).not.toBe(b); expect(texts.get(a!)).toContain('Correct: 1'); expect(texts.get(b!)).toContain('Total: 0'); } finally { vi.useRealTimers(); }
	});
	it('presets persist and update a same-name preset', async () => {
		const m = manager(true); const { plugin } = fixture();
		await plugin.addPreset('exam', 'Q:'); await plugin.addPreset('exam', 'Question:');
		expect(plugin.settings.presets).toEqual([{ name: 'exam', marker: 'Question:' }]); await plugin.usePreset('exam'); expect(plugin.settings.marker).toBe('Question:');
		m.set(false); expect(await plugin.addPreset('other', '?')).toBe(false); expect(plugin.settings.presets).toHaveLength(1);
	});
	it('invalid markers and preset records are repaired', () => {
		expect(normalizeSettings({ marker: ' ', presets: [null, { name: 'ok', marker: 'Q:' }, { name: '', marker: '?' }] as never })).toEqual({ marker: '?', presets: [{ name: 'ok', marker: 'Q:' }] });
	});
	it('Pro facade tells listeners and resets cleanly', () => {
		const m = manager(false); const cb = vi.fn(); const off = onProChange(cb);
		m.set(true); expect(isPro()).toBe(true); expect(cb).toHaveBeenCalledTimes(1); off(); m.set(false); expect(cb).toHaveBeenCalledTimes(1); resetPro(); expect(isPro()).toBe(false);
	});
	it('the sponsor values match the reference', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
	});
	it('a failed action is caught', async () => { const { plugin } = fixture(); await expect(plugin.run(async () => { throw new Error('disk full'); })).resolves.toBeUndefined(); });
});
