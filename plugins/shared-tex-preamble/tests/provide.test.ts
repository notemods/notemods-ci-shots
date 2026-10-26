import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { engineSource, parsePreamble } from '../src/preamble';
import manifest from '../manifest.json';

/** A small stand-in for the math engine. Like MathJax 3 and 4, it has no \providecommand and shows an undefined command as red text. */
const engine = vi.hoisted(() => {
	const defined = new Set<string>(['frac', 'mathbb']);
	const sources: string[] = [];
	const red = (name: string) => {
		const span = document.createElement('span');
		const t = document.createElement('mjx-mtext');
		t.setAttribute('style', 'color: red;');
		t.textContent = `\\${name}`;
		span.appendChild(t);
		return span;
	};
	const renderMath = (source: string): HTMLElement => {
		sources.push(source);
		const def = /^\\(newcommand|renewcommand|def|DeclareMathOperator)\*?\s*\{?\\([A-Za-z]+)/.exec(source);
		if (def) {
			defined.add(def[2]!);
			return document.createElement('span');
		}
		for (const m of source.matchAll(/\\([A-Za-z]+)/g)) if (!defined.has(m[1]!)) return red(m[1]!);
		return document.createElement('span');
	};
	return { defined, sources, renderMath };
});

vi.mock('obsidian', async (orig) => ({ ...(await orig<object>()), renderMath: engine.renderMath, loadMathJax: async () => {}, finishRenderMath: async () => {} }));

const { default: SharedTexPreamblePlugin } = await import('../src/main');

async function load(text: string) {
	const app = App.createConfigured__({ files: { 'Macros.tex': text } });
	const p = new SharedTexPreamblePlugin(app as never, manifest as never);
	await p.loadSettings();
	p.settings.path = 'Macros.tex';
	return p;
}

describe('providecommand', () => {
	it('gives the engine \\newcommand, because MathJax has no \\providecommand', () => {
		const [d] = parsePreamble('\\providecommand*{\\Pa}[1]{#1}').defs;
		expect(engineSource(d!)).toBe('\\newcommand*{\\Pa}[1]{#1}');
		const [n] = parsePreamble('\\newcommand{\\Pb}{x}').defs;
		expect(engineSource(n!)).toBe('\\newcommand{\\Pb}{x}');
	});

	it('defines a new command and keeps a command that the engine already has', async () => {
		const p = await load('\\providecommand{\\Pcheck}{3+4}\n\\providecommand{\\frac}{x}\n');
		const r = await p.reload('command');
		expect(r).toMatchObject({ status: 'ok', loaded: ['Pcheck', 'frac'], errors: [] });
		expect(engine.sources).toContain('\\newcommand{\\Pcheck}{3+4}');
		expect(engine.sources).not.toContain('\\newcommand{\\frac}{x}');
	});

	it('keeps an earlier definition of the same file, and a changed body takes effect at the next reload', async () => {
		const p = await load('\\newcommand{\\Pdup}{1}\n\\providecommand{\\Pdup}{2}\n\\providecommand{\\Pnext}{a}\n');
		await p.reload('command');
		expect(engine.sources).not.toContain('\\newcommand{\\Pdup}{2}');
		await p.app.vault.modify(p.app.vault.getFileByPath('Macros.tex')!, '\\providecommand{\\Pnext}{b}\n');
		const r = await p.reload('command');
		expect(r).toMatchObject({ loaded: ['Pnext'], errors: [] });
		expect(engine.sources).toContain('\\newcommand{\\Pnext}{b}');
	});
});

describe('providecommand of an engine command', () => {
	it('keeps the engine command at each reload', async () => {
		const p = await load('\\providecommand{\\mathbb}{x}\n');
		await p.reload('command');
		await p.reload('command');
		expect(engine.sources).not.toContain('\\newcommand{\\mathbb}{x}');
	});
});

describe('large macro files', () => {
	it('parses 20000 definitions with the right line numbers in linear time', () => {
		const lines = Array.from({ length: 20_000 }, (_, i) => `\\newcommand{\\m${String.fromCharCode(97 + (i % 26))}${'x'.repeat(Math.floor(i / 26) % 30)}}{${i}}`);
		lines[19_999] = '\\newcommand{\\bad}';
		const t = performance.now();
		const p = parsePreamble(lines.join('\n'));
		// The quadratic line count took about 13 s here; linear time takes well under 1 s.
		expect(performance.now() - t).toBeLessThan(3000);
		expect(p.defs).toHaveLength(19_999);
		expect(p.defs[19_998]!.line).toBe(19_999);
		expect(p.errors).toEqual([{ line: 20_000, message: '\\newcommand{\\bad} has no replacement text' }]);
	});
});
