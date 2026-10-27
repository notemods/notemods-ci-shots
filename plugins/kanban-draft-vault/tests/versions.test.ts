import { describe, expect, it } from 'vitest';
import { captureDraft, type DraftSettings } from '../src/model';

function typeText(settings: DraftSettings, text: string, at: number): { settings: DraftSettings; at: number } {
	for (let i = 1; i <= text.length; i++) settings = captureDraft(settings, { id: 'one', board: 'Board A.md', lane: 'Todo', text: text.slice(0, i), at: at += 150 }, true);
	return { settings, at };
}

describe('Pro saved versions', () => {
	it('keeps a replaced draft after more than ten keystrokes of new text', () => {
		let state = typeText({ drafts: [], limits: {} }, 'Call Ana about the launch', 1000);
		state = typeText(state.settings, 'Send the agenda to the team', state.at + 60000);
		const versions = state.settings.drafts[0]!.versions.map((v) => v.text);
		expect(state.settings.drafts[0]!.text).toBe('Send the agenda to the team');
		expect(versions).toContain('Call Ana about the launch');
	});
	it('keeps a checkpoint at a typing pause', () => {
		let state = typeText({ drafts: [], limits: {} }, 'Call Ana', 1000);
		state = typeText(state.settings, 'Call Ana tomorrow', state.at + 60000);
		expect(state.settings.drafts[0]!.versions.map((v) => v.text)).toContain('Call Ana');
	});
	it('keeps the longer text when backspace runs in the same burst', () => {
		let settings = typeText({ drafts: [], limits: {} }, 'Call Ana', 1000).settings;
		for (const [i, text] of ['Call An', 'Call A', 'Call ', 'Call B', 'Call Bo', 'Call Bob'].entries()) settings = captureDraft(settings, { id: 'one', board: 'Board A.md', lane: 'Todo', text, at: 3000 + i * 150 }, true);
		expect(settings.drafts[0]!.versions.map((v) => v.text)).toContain('Call Ana');
	});
});
