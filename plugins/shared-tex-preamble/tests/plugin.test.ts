import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { App } from 'obsidian-test-mocks/obsidian';
import SharedTexPreamblePlugin from '../src/main';
import { mathError } from '../src/math';
import { PRO_UI, SPONSORS, bindPro, isPro, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, MAX_LIBRARIES, nextLibraryName, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

afterEach(() => resetPro());

/** A stand-in for the SponsorsManager: only isPro and onChange, which the facade uses. */
function fakeManager(start: boolean) {
	let pro = start;
	const fns = new Set<() => void>();
	return {
		isPro: () => pro,
		getState: () => ({ status: 'signed-out', lastAttemptAt: 0 }), hasToken: () => false, config: { sponsorLogin: 'theluckystrike' },
		onChange: (fn: () => void) => {
			fns.add(fn);
			return () => fns.delete(fn);
		},
		set(v: boolean) {
			pro = v;
			for (const fn of fns) fn();
		},
	};
}

const VCHECK = '\\newcommand{\\Vcheck}[1]{#1+7}';

async function plugin(files: Record<string, string>, settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
	const app = App.createConfigured__({ files });
	const p = new SharedTexPreamblePlugin(app as never, manifest as never);
	await p.loadSettings();
	p.settings = normalizeSettings({ ...p.settings, ...settings });
	return { app, p };
}

async function read(app: unknown, path: string): Promise<string> {
	const a = app as { vault: { getFileByPath(p: string): unknown; read(f: unknown): Promise<string> } };
	return a.vault.read(a.vault.getFileByPath(path));
}

describe('load the macro file', () => {
	it('case 1: loads one definition and leaves the notes unchanged', async () => {
		const { app, p } = await plugin({ 'Macros.tex': VCHECK, 'A.md': '$\\Vcheck{2}$', 'B.md': '$$\\Vcheck{2}$$' }, { path: 'Macros.tex' });
		const r = await p.reload('command');
		expect(r).toMatchObject({ status: 'ok', loaded: ['Vcheck'], errors: [] });
		expect(await read(app, 'A.md')).toBe('$\\Vcheck{2}$');
		expect(await read(app, 'B.md')).toBe('$$\\Vcheck{2}$$');
	});

	it('case 2: startup loads the saved path without a notice for a good file', async () => {
		const { p } = await plugin({ 'Macros.md': `# Macros\n\n$$\n${VCHECK}\n$$\n` }, { path: 'Macros.md' });
		const r = await p.reload('startup');
		expect(r).toMatchObject({ status: 'ok', loaded: ['Vcheck'] });
		expect(p.statusText()).toBe('Last load: 1 definition from "Macros.md", 0 errors.');
	});

	it('case 4: a missing file creates no file', async () => {
		const { app, p } = await plugin({ 'A.md': 'x' }, { path: 'Missing.tex' });
		const r = await p.reload('command');
		expect(r.status).toBe('missing');
		expect((app as unknown as { vault: { getFileByPath(p: string): unknown } }).vault.getFileByPath('Missing.tex')).toBeNull();
	});

	it('case 5: an empty file gives status empty', async () => {
		const { p } = await plugin({ 'Empty.tex': '' }, { path: 'Empty.tex' });
		expect((await p.reload('command')).status).toBe('empty');
	});

	it('case 6: a parse error is reported and the good definitions still load', async () => {
		const { p } = await plugin({ 'M.tex': `\\newcommand{\\Broken}[1]\n${VCHECK}` }, { path: 'M.tex' });
		const r = await p.reload('command');
		expect(r.status).toBe('ok');
		expect(r.loaded).toEqual(['Vcheck']);
		expect(r.errors).toEqual([{ line: 1, message: '\\newcommand{\\Broken} has no replacement text' }]);
	});

	it('case 7: a package command rejects the whole file', async () => {
		const { p } = await plugin({ 'M.tex': `${VCHECK}\n\\require{some-package}` }, { path: 'M.tex' });
		const r = await p.reload('command');
		expect(r.status).toBe('rejected');
		expect(r.loaded).toEqual([]);
	});

	it('no path and wrong file type load nothing', async () => {
		const a = await plugin({});
		expect((await a.p.reload('command')).status).toBe('no-path');
		const b = await plugin({ 'x.pdf': '' }, { path: 'x.pdf' });
		expect((await b.p.reload('command')).status).toBe('wrong-type');
	});
});

describe('math errors', () => {
	it('reads the engine error attribute', () => {
		const el = createDiv();
		expect(mathError(el)).toBeNull();
		el.createEl('span', { attr: { 'data-mjx-error': 'Missing argument for \\newcommand' } });
		expect(mathError(el)).toBe('Missing argument for \\newcommand');
	});
});

describe('settings', () => {
	it('repairs bad saved settings', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ path: 5 as never, libraries: 'x' as never, active: 3 as never })).toEqual(DEFAULT_SETTINGS);
		const s = normalizeSettings({ libraries: [{ name: ' A ', path: 'a.tex' }, { name: 'A', path: 'b.tex' }, { name: '', path: 'c' }, null as never], active: 'A' });
		expect(s.libraries).toEqual([{ name: 'A', path: 'a.tex' }]);
		expect(s.active).toBe('A');
		expect(normalizeSettings({ active: 'Gone' }).active).toBe('');
		const many = Array.from({ length: 30 }, (_, i) => ({ name: `L${i}`, path: '' }));
		expect(normalizeSettings({ libraries: many }).libraries).toHaveLength(MAX_LIBRARIES);
	});

	it('gives the next free library name', () => {
		expect(nextLibraryName([])).toBe('Library 1');
		expect(nextLibraryName([{ name: 'Library 1', path: '' }, { name: 'Library 3', path: '' }])).toBe('Library 2');
	});
});

describe('Pro', () => {
	// product.yaml lives only in the monorepo; the exported repo has no copy, so the check runs there only.
	it.skipIf(!existsSync('product.yaml'))('keeps the values of product.yaml', () => {
		const yaml = readFileSync('product.yaml', 'utf8');
		expect(yaml).toContain(`client_id: ${SPONSORS.clientId}`);
		expect(yaml).toContain(`summary: ${PRO_UI.proSummary}`);
		expect(yaml).toContain('price: $5 a month or $15 once');
	});

	it('the active library needs Pro; without Pro the macro file loads', async () => {
		const files = { 'Macros.tex': VCHECK, 'Physics.tex': '\\newcommand{\\ket}[1]{|#1\\rangle}' };
		const { p } = await plugin(files, { path: 'Macros.tex', libraries: [{ name: 'Physics', path: 'Physics.tex' }], active: 'Physics' });
		const m = fakeManager(false);
		bindPro(m as never);
		expect(isPro()).toBe(false);
		expect(p.activePath()).toBe('Macros.tex');
		expect(await p.selectLibrary('Physics')).toBeNull();
		m.set(true);
		expect(p.activePath()).toBe('Physics.tex');
		const r = await p.selectLibrary('Physics');
		expect(r).toMatchObject({ status: 'ok', loaded: ['ket'], path: 'Physics.tex' });
		expect(await p.selectLibrary('Nope')).toBeNull();
	});

	it('preview needs Pro', async () => {
		const { p } = await plugin({ 'Macros.tex': VCHECK }, { path: 'Macros.tex' });
		bindPro(fakeManager(false) as never);
		expect(await p.preview({ name: '', label: 'Macro file', path: 'Macros.tex' })).toBeNull();
	});
});

describe('mobile', () => {
	it('manifest allows mobile and the source imports no Node or Electron module', () => {
		expect(manifest.isDesktopOnly).toBe(false);
		for (const f of ['main.ts', 'preamble.ts', 'preview.ts', 'settings.ts', 'math.ts', 'pro.ts']) {
			const src = readFileSync(`src/${f}`, 'utf8');
			expect(src).not.toMatch(/from ['"](node:|fs|path|electron|child_process)/);
		}
	});
});

describe('math text', () => {
	it('reads MathJax 4 text and MathJax 3 glyph classes', async () => {
		const { mathText } = await import('../src/math');
		const v4 = createDiv();
		v4.innerHTML = '<mjx-mn><mjx-c class="mjx-c32">2</mjx-c></mjx-mn><mjx-mo><mjx-c class="mjx-c2B">+</mjx-c></mjx-mo>';
		expect(mathText(v4)).toBe('2+');
		const v3 = createDiv();
		v3.innerHTML = '<mjx-mtext style="color: red;"><mjx-c class="mjx-c5C"></mjx-c><mjx-c class="mjx-c56"></mjx-c><mjx-c class="mjx-c78"></mjx-c></mjx-mtext>';
		expect(mathText(v3)).toBe('\\Vx');
		expect(mathError(v3)).toBe('Undefined control sequence \\Vx');
	});
});
