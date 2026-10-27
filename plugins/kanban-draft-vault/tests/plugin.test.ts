import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import KanbanDraftVaultPlugin from '../src/main';
import { normalizeSettings } from '../src/model';
import { copyOrSelect } from '../src/recovery';
import { SPONSORS, bindPro, isPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => resetPro());
function plugin() {
	const app = App.createConfigured__({ files: { 'Board A.md': '## Todo\n\n- [ ] Existing card' } });
	return new KanbanDraftVaultPlugin(app as never, manifest as never);
}
function pro(enabled: boolean) { bindPro({ isPro: () => enabled, onChange: () => () => {} } as never); }
const input = { id: 'one', board: 'Board A.md', lane: 'Todo', text: 'Call Ana', at: Date.now() };

describe('local recovery and Pro guards', () => {
	it('loads an empty store with no account', async () => {
		const p = plugin(); await p.loadSettings();
		expect(p.settings).toEqual({ drafts: [], limits: {} });
		expect(isPro()).toBe(false);
	});
	it('retains saved text across a normal reload without changing the board', async () => {
		const p = plugin();
		const before = await p.app.vault.read(p.app.vault.getFileByPath('Board A.md')!);
		p.capture(input); await p.saves.flush();
		p.settings = { drafts: [], limits: {} }; await p.loadSettings();
		expect(p.settings.drafts[0]?.text).toBe('Call Ana');
		expect(await p.app.vault.read(p.app.vault.getFileByPath('Board A.md')!)).toBe(before);
	});
	it('saves dismissal so it stays absent after a reload', async () => {
		const p = plugin(); p.capture(input); await p.saves.flush();
		await p.dismiss('one'); await p.loadSettings();
		expect(p.settings.drafts).toEqual([]);
	});
	it('rejects board limit changes without Pro', async () => {
		const p = plugin(); p.capture(input);
		expect(await p.setBoardLimit('Board A.md', { drafts: 1 })).toBe(false);
		expect(p.settings.limits).toEqual({}); await p.saves.flush();
	});
	it('keeps versions and applies board limits with Pro', async () => {
		pro(true); const p = plugin();
		p.capture(input); p.capture({ ...input, text: 'Call Ana tomorrow', at: input.at + 1 });
		expect(p.settings.drafts[0]?.versions[0]?.text).toBe('Call Ana');
		expect(await p.setBoardLimit('Board A.md', { drafts: 1, days: 30, versions: 2 })).toBe(true);
		expect(p.settings.limits['Board A.md']).toEqual({ drafts: 1, days: 30, versions: 2 });
	});
	it('uses the reference GitHub Sponsors price and public client id', () => {
		expect(SPONSORS).toEqual({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
	});
	it('repairs malformed saved settings', () => {
		expect(normalizeSettings({ drafts: [null, 42, { id: 'x', text: '' }], limits: null })).toEqual({ drafts: [], limits: {} });
	});
});

describe('copy-only recovery', () => {
	it('selects the complete multiline Unicode text when clipboard access is denied', async () => {
		const field = document.createElement('textarea'); document.body.append(field);
		const text = 'Call Ana\nAsk about café ☕\n  Keep spacing';
		const write = vi.fn().mockRejectedValue(new Error('permission denied'));
		expect(await copyOrSelect(text, field, write)).toBe(false);
		expect(field.value).toBe(text);
		expect(field.selectionStart).toBe(0); expect(field.selectionEnd).toBe(text.length);
		field.remove();
	});
	it('copies the exact text and retains the record', async () => {
		const p = plugin(); p.capture(input); await p.saves.flush();
		const field = document.createElement('textarea'); const write = vi.fn().mockResolvedValue(undefined);
		expect(await copyOrSelect(input.text, field, write)).toBe(true);
		expect(write).toHaveBeenCalledWith('Call Ana');
		expect(p.settings.drafts).toHaveLength(1);
	});
});
