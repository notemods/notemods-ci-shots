import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Modal } from 'obsidian-test-mocks/obsidian';
import SubtitleSentenceMinerPlugin from '../src/main';
import { parseSubtitles } from '../src/cues';
import { DEFAULT_TEMPLATE, exactCloze } from '../src/cards';
import { MinerModal } from '../src/ui';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

const source = '1\n00:00:01,000 --> 00:00:03,500\nHello world.';
function plugin() {
	const app = App.createConfigured__({ files: { 'hello.srt': source } });
	return new SubtitleSentenceMinerPlugin(app as never, manifest as never);
}
beforeEach(() => {
	vi.spyOn(Modal.prototype, 'open').mockImplementation(function () { document.body.append(this.containerEl); this.onOpen(); });
});
afterEach(() => { resetPro(); document.body.empty(); vi.restoreAllMocks(); });

describe('review findings', () => {
	it('keeps a cue after a second blank line that has spaces', () => {
		const r = parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nHi\n\n \n2\n00:00:03,000 --> 00:00:04,000\nThere\n\t\n\n3\n00:00:05,000 --> 00:00:06,000\nEnd');
		expect(r.cues.map((c) => c.text)).toEqual(['Hi', 'There', 'End']);
		expect(r.warnings).toEqual([]);
	});
	it('refuses a cloze span that ends with a closing brace', () => {
		expect(() => exactCloze('a}b', 0, 2)).toThrow('reserved cloze markers');
	});
	it('skips a block with more than one timing arrow', () => {
		const r = parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\n00:00:02,000 --> 00:00:03,000\nText');
		expect(r.cues).toEqual([]);
		expect(r.warnings).toEqual(['Skipped malformed cue 1.']);
	});
	it('replaces a template with the same name and stops at 30 templates', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const p = plugin(); vi.spyOn(p, 'saveData').mockResolvedValue();
		for (let n = 0; n < 30; n++) await p.saveTemplate({ name: `T${n}`, body: DEFAULT_TEMPLATE });
		await p.saveTemplate({ name: 'T0', body: '{{sentence}}' });
		expect(p.settings.templates).toHaveLength(30);
		expect(p.settings.templates.find((t) => t.name === 'T0')?.body).toBe('{{sentence}}');
		await expect(p.saveTemplate({ name: 'T30', body: DEFAULT_TEMPLATE })).rejects.toThrow('limit is 30');
		await expect(p.saveTemplate({ name: 'Long', body: '{{sentence}}' + 'x'.repeat(10000) })).rejects.toThrow('10000');
	});
	it('refuses a source that is already in the combined list', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const p = plugin(); const file = p.app.vault.getFiles().find((f) => f.path === 'hello.srt')!;
		const modal = new MinerModal(p, 'hello.srt', parseSubtitles(source)); modal.open();
		await modal.addSource(file);
		expect(modal.entries).toHaveLength(1);
		modal.close();
	});
});
