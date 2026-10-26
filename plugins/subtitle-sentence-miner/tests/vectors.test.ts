import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import vectors from './vectors/subtitle-sentence-miner.json';
import * as cues from '../src/cues';
import * as cards from '../src/cards';
import SubtitleSentenceMinerPlugin from '../src/main';
import { PreviewModal } from '../src/ui';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => resetPro());

interface Vector { name: string; function: string; args: unknown[]; expected: unknown }

describe('acceptance vectors', () => {
	it('has at least 20 acceptance vectors', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const vector of vectors.cases as Vector[]) {
		it(vector.name, async () => {
			if (vector.function === 'availablePath') {
				const [path, existing] = vector.args as [string, string[]];
				expect(cards.availablePath(path, (p) => existing.includes(p))).toEqual(vector.expected);
			} else if (vector.function === 'cancelPreview') {
				const source = vector.args[0] as string;
				const app = App.createConfigured__({ files: { 'French.srt': source } });
				const plugin = new SubtitleSentenceMinerPlugin(app as never, manifest as never);
				const create = vi.spyOn(plugin.app.vault, 'create');
				const preview = new PreviewModal(plugin, [{ source: 'French.srt', cue: cues.parseSubtitles(source).cues[0]!, answer: { kind: 'qa', question: 'Greeting?', answer: 'Bonjour.' } }]);
				preview.open(); preview.close();
				expect({ created: create.mock.calls, source: await plugin.app.vault.read(plugin.app.vault.getFiles()[0]!) }).toEqual(vector.expected);
			} else {
				const functions = { ...cues, ...cards } as unknown as Record<string, (...args: unknown[]) => unknown>;
				expect(functions[vector.function]!(...vector.args)).toEqual(vector.expected);
			}
		});
	}
});
