import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Modal } from 'obsidian-test-mocks/obsidian';
import SubtitleSentenceMinerPlugin from '../src/main';
import { parseSubtitles } from '../src/cues';
import { DEFAULT_TEMPLATE, type Card } from '../src/cards';
import { AnswerModal, MinerModal, PreviewModal, SourcePicker } from '../src/ui';
import { bindPro, isPro, onProChange, resetPro, SPONSORS } from '../src/pro';
import { normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

const source = '1\n00:00:01,000 --> 00:00:03,500\nHello world.\n\n2\n00:00:04,000 --> 00:00:05,000\nAu revoir.';
const card: Card = { source: 'hello.srt', cue: parseSubtitles(source).cues[0]!, answer: { kind: 'cloze', start: 6, end: 11 } };
function plugin(files: Record<string, string> = {}) {
	const app = App.createConfigured__({ files: { 'hello.srt': source, 'other.vtt': 'WEBVTT\n\n00:01.000 --> 00:02.000\nBonjour.', ...files } });
	return new SubtitleSentenceMinerPlugin(app as never, manifest as never);
}
function pro(active: boolean) { bindPro({ isPro: () => active, onChange: () => () => undefined } as never); }
function button(modal: { contentEl: HTMLElement }, key: string): HTMLButtonElement { return modal.contentEl.querySelector<HTMLButtonElement>(`[data-ssm="${key}"]`)!; }
// The mock auto-closes a modal at the next timer tick. Keep it open for async workflow checks.
beforeEach(() => {
	vi.spyOn(Modal.prototype, 'open').mockImplementation(function () {
		document.body.append(this.containerEl);
		this.onOpen();
	});
});
afterEach(() => { resetPro(); document.body.empty(); vi.restoreAllMocks(); });

describe('new file workflow', () => {
	it('creates a note with folders and leaves source bytes unchanged', async () => {
		const p = plugin();
		await p.createCards('Study/French/Cards.md', [card]);
		const file = p.app.vault.getFiles().find((f) => f.path === 'Study/French/Cards.md')!;
		expect(await p.app.vault.read(file)).toContain('Hello {{c1::world}}.');
		expect(await p.app.vault.read(p.app.vault.getFiles().find((f) => f.path === 'hello.srt')!)).toBe(source);
	});
	it('does not overwrite an existing file', async () => {
		const p = plugin({ 'Cards.md': 'Keep this' });
		expect(p.planPath('Cards.md')).toBe('Cards 2.md');
		await expect(p.createCards('Cards.md', [card])).rejects.toThrow('now in use');
		expect(await p.app.vault.read(p.app.vault.getFiles().find((f) => f.path === 'Cards.md')!)).toBe('Keep this');
	});
	it('requires another confirmation after the output path changes', async () => {
		const p = plugin(); p.settings.outputPath = 'Cards.md';
		const preview = new PreviewModal(p, [card]); preview.open();
		await p.app.vault.create('Cards.md', 'Keep');
		button(preview, 'create-note').click();
		expect(preview.contentEl.querySelector<HTMLInputElement>('[data-ssm="output-path"]')!.value).toBe('Cards 2.md');
		expect(p.app.vault.getAbstractFileByPath('Cards 2.md')).toBeNull();
		button(preview, 'create-note').click();
		await vi.waitFor(() => expect(p.app.vault.getAbstractFileByPath('Cards 2.md')).not.toBeNull());
	});
	it('writes no file when the Cancel button is selected', () => {
		const p = plugin(); const create = vi.spyOn(p.app.vault, 'create');
		const preview = new PreviewModal(p, [card]); preview.open();
		button(preview, 'cancel-export').click();
		expect(create).not.toHaveBeenCalled();
	});
	it('a disk error stays in the preview and leaves the source', async () => {
		const p = plugin(); const preview = new PreviewModal(p, [card]); preview.open();
		vi.spyOn(p.app.vault, 'create').mockRejectedValue(new Error('Disk full'));
		button(preview, 'create-note').click();
		await vi.waitFor(() => expect(preview.contentEl.querySelector('.ssm-export-status')?.textContent).toBe('Disk full'));
	});
	it('a file cannot be used as an output folder', async () => {
		const p = plugin({ 'Study': 'file' });
		await expect(p.createCards('Study/Cards.md', [card])).rejects.toThrow('blocks');
	});
	it('a double click writes only one file', async () => {
		const p = plugin(); const create = vi.spyOn(p.app.vault, 'create');
		const preview = new PreviewModal(p, [card]); preview.open();
		const b = button(preview, 'create-note'); b.click(); b.click();
		await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
	});
});

describe('cue browser and answers', () => {
	it('the picker lists subtitle files but not Markdown notes', () => {
		const p = plugin({ 'Notes.md': 'text', 'TEST.SRT': source });
		const picker = new SourcePicker(p, async () => undefined);
		expect(picker.getSuggestions('').map((f) => f.path)).toEqual(['hello.srt', 'other.vtt', 'TEST.SRT']);
		expect(picker.getSuggestions('OTHER').map((f) => f.path)).toEqual(['other.vtt']);
	});
	it('filter changes do not remove a selected cue', () => {
		const p = plugin(); const modal = new MinerModal(p, card.source, parseSubtitles(source)); modal.open();
		modal.entries[0]!.selected = true; modal.entries[0]!.answer = card.answer;
		modal.query = 'revoir'; modal.drawList();
		expect(modal.contentEl.querySelectorAll('.ssm-cue')).toHaveLength(1);
		expect(modal.entries[0]!.selected).toBe(true);
		expect(modal.contentEl.querySelector('.ssm-summary')!.textContent).toContain('1 selected');
		modal.close();
	});
	it('requires answers before opening a preview', () => {
		const p = plugin(); const modal = new MinerModal(p, card.source, parseSubtitles(source)); modal.open();
		modal.entries[0]!.selected = true; modal.preview();
		expect(document.querySelector('.ssm-preview')).toBeNull(); modal.close();
	});
	it('stores the exact selected occurrence from the readonly text box', () => {
		const p = plugin(); const save = vi.fn();
		const modal = new AnswerModal(p, { ...card.cue, text: 'go go go' }, undefined, save); modal.open();
		const text = modal.contentEl.querySelector<HTMLTextAreaElement>('[data-ssm="span-text"]')!;
		text.setSelectionRange(3, 5); button(modal, 'save-cloze').click();
		expect(save).toHaveBeenCalledWith({ kind: 'cloze', start: 3, end: 5 });
	});
	it('cancelled answer entry does not change the cue', () => {
		const save = vi.fn(); const modal = new AnswerModal(plugin(), card.cue, undefined, save); modal.open(); modal.close();
		expect(save).not.toHaveBeenCalled();
	});
});

describe('Sponsors Pro gates', () => {
	it('uses the reference public client and amounts', () => expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' }));
	it('free creation does not need a Pro manager', async () => { expect(isPro()).toBe(false); await expect(plugin().createCards('Cards.md', [card])).resolves.toMatchObject({ path: 'Cards.md' }); });
	it('rejects combined cards and custom templates when Pro is off', async () => {
		const p = plugin(); const create = vi.spyOn(p.app.vault, 'create');
		await expect(p.createCards('Cards.md', [card, { ...card, source: 'other.vtt' }])).rejects.toThrow('need Pro');
		await expect(p.createCards('Cards.md', [card], DEFAULT_TEMPLATE)).rejects.toThrow('need Pro');
		await expect(p.saveTemplate({ name: 'Study', body: DEFAULT_TEMPLATE })).rejects.toThrow('need Pro');
		expect(create).not.toHaveBeenCalled();
	});
	it('saves a template and combines files with Pro', async () => {
		pro(true); const p = plugin(); vi.spyOn(p, 'saveData').mockResolvedValue();
		await p.saveTemplate({ name: 'Study', body: '{{sentence}}\nBack: {{answer}}' });
		await p.createCards('Cards.md', [card, { ...card, source: 'other.vtt' }], p.settings.templates[0]!.body);
		const text = await p.app.vault.read(p.app.vault.getFiles().find((f) => f.path === 'Cards.md')!);
		expect(text).toContain('Source path: other.vtt'); expect(text).toContain('Back: world');
	});
	it('checks Pro again after a preview has opened', async () => {
		pro(true); const p = plugin(); const preview = new PreviewModal(p, [card, { ...card, source: 'other.vtt' }]); preview.open();
		pro(false); button(preview, 'create-note').click();
		await vi.waitFor(() => expect(preview.contentEl.querySelector('.ssm-export-status')!.textContent).toContain('need Pro'));
		expect(p.app.vault.getFiles().filter((f) => f.extension === 'md')).toHaveLength(0);
	});
	it('the facade follows changes and removes its listener', () => {
		let active = false; let change = () => undefined;
		const off = vi.fn(); bindPro({ isPro: () => active, onChange: (cb: () => void) => { change = cb; return off; } } as never);
		const listener = vi.fn(); const stop = onProChange(listener); active = true; change();
		expect(isPro()).toBe(true); expect(listener).toHaveBeenCalledTimes(1); stop(); resetPro(); expect(off).toHaveBeenCalledTimes(1);
	});
	it('repairs malformed stored templates', () => {
		expect(normalizeSettings({ outputPath: 5, templates: [null, { name: 'Broken', body: '{{unknown}}' }, { name: 'Good', body: '{{sentence}}' }] })).toEqual({ outputPath: 'Sentence cards/Subtitle cards.md', templates: [{ name: 'Good', body: '{{sentence}}' }] });
	});
});
