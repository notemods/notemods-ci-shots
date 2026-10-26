import { browser, expect } from '@wdio/globals';
import { setPath, write, type PluginApi } from './helpers';

/** Renders the source with the public renderMath and returns its glyph text without spaces and function marks, or ERR: and the text. */
async function rendered(source: string): Promise<string> {
	return browser.executeObsidian(async ({ obsidian }, s) => {
		await obsidian.loadMathJax();
		const el = obsidian.renderMath(s, false);
		const text = (e: Element) => Array.from(e.querySelectorAll('mjx-c')).map((c) => c.textContent || String.fromCodePoint(parseInt(/mjx-c([0-9A-F]+)/.exec(c.getAttribute('class') ?? '')?.[1] ?? '20', 16))).join('');
		const err = el.querySelector('[data-mjx-error], mjx-merror, mjx-mtext[style*="red"]');
		return (err ? 'ERR:' : '') + text(el).replace(/[\s\u2061]+/g, '');
	}, source);
}

describe('shared-tex-preamble definition kinds', function () {
	it('each documented definition command loads in the real engine', async function () {
		await write(
			'Kinds.tex',
			[
				'\\newcommand{\\Ncheck}[1]{#1+1}',
				'\\renewcommand{\\Ncheck}[1]{#1+2}',
				'\\providecommand{\\Pcheck}{3+4}',
				'\\def\\Dcheck#1{#1+5}',
				'\\DeclareMathOperator{\\Tcheck}{tq}',
				'\\newcommand{\\Ocheck}[2][7]{#1+#2}',
				'',
			].join('\n'),
		);
		await setPath('Kinds.tex');
		const result = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, PluginApi> } }).plugins.plugins['shared-tex-preamble']!;
			return plugin.reload('command');
		});
		expect(result.errors).toEqual([]);
		expect(result.loaded).toEqual(['Ncheck', 'Ncheck', 'Pcheck', 'Dcheck', 'Tcheck', 'Ocheck']);
		expect(await rendered('\\Ncheck{2}')).toBe('2+2');
		expect(await rendered('\\Pcheck')).toBe('3+4');
		expect(await rendered('\\Dcheck{2}')).toBe('2+5');
		expect(await rendered('\\Tcheck 2')).toBe('tq2');
		expect(await rendered('\\Ocheck{2}')).toBe('7+2');
		expect(await rendered('\\Ocheck[5]{2}')).toBe('5+2');
	});
});
