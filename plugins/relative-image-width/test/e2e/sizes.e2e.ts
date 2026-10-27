import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Real-app checks for the acceptance criteria of SPEC.md, on minAppVersion (1.13.4) and on the latest app.
// The vault image wide.png is 800 x 400 px. The text column is narrower, so a natural image fills the column.
const SIZES = [
	'A ![[wide.png|50%]]',
	'',
	'B ![[wide.png|50%x30%]]',
	'',
	'C ![[wide.png|20rem]]',
	'',
	'D ![[wide.png|8em]]',
	'',
	'E ![[wide.png|40vw]]',
	'',
	'F ![alt|50%](wide.png)',
	'',
	'G ![[wide.png|200]]',
	'',
	'H ![[wide.png|cap|25%]]',
	'',
	'I ![Image](wide.png){width=30%}',
	'',
	'J ![[wide.png]]',
	'',
	'End.',
].join('\n');
const ACTIVE = '.workspace-leaf.mod-active';

interface Shot {
	label: string;
	w: number;
	h: number;
	col: number;
	alt: string | null;
	mark: string | null;
	style: string;
	rem: number;
	em: number;
	vw: number;
	vh: number;
	dbg: string;
}

type Mode = 'source' | 'preview';

async function setMode(mode: Mode): Promise<void> {
	await browser.executeObsidian(async ({ app }, m) => {
		const leaf = app.workspace.getMostRecentLeaf();
		if (!leaf) return;
		const s = leaf.getViewState();
		await leaf.setViewState({ ...s, state: { ...s.state, mode: m, source: false } });
	}, mode);
}

async function open(path: string, mode: Mode): Promise<void> {
	await obsidianPage.openFile(path);
	await setMode(mode);
	if (mode === 'source') {
		// The cursor on the last line, so no image line shows its source text.
		await browser.executeObsidian(({ app }) => {
			const e = app.workspace.activeEditor?.editor;
			if (e) e.setCursor({ line: e.lastLine(), ch: 0 });
		});
	}
}

/** Size of each image of the active view, keyed by the first letter of its line. */
async function shots(mode: Mode): Promise<Shot[]> {
	return browser.execute(
		(sel: string, m: string) => {
			const root = document.querySelector(`${sel} ${m === 'source' ? '.markdown-source-view .cm-content' : '.markdown-reading-view'}`);
			if (!root) return [];
			const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
			return Array.from(root.querySelectorAll('img'))
				.filter((img) => !img.classList.contains('cm-widgetBuffer'))
				.map((img) => {
					const line = img.closest('.cm-line, p, div.el-p') as HTMLElement | null;
					const ls = line ? getComputedStyle(line) : null;
					const col = line ? line.clientWidth - parseFloat(ls!.paddingLeft) - parseFloat(ls!.paddingRight) : 0;
					const r = img.getBoundingClientRect();
					return {
						label: (line?.textContent ?? '').trim().slice(0, 1),
						w: Math.round(r.width),
						h: Math.round(r.height),
						col: Math.round(col),
						alt: img.getAttribute('alt'),
						mark: img.getAttribute('data-riw'),
						style: img.getAttribute('style') ?? '',
						rem,
						em: parseFloat(getComputedStyle(img).fontSize),
						vw: window.innerWidth / 100,
						vh: window.innerHeight / 100,
						dbg: [img, img.parentElement, img.parentElement?.parentElement]
							.map((e) => {
								if (!e) return '-';
								const cs = getComputedStyle(e);
								return `${e.tagName}.${e.className}[d=${cs.display} w=${cs.width} mw=${cs.maxWidth} h=${cs.height} pos=${cs.position} ct=${cs.containerType}]`;
							})
							.join(' < '),
					};
				});
		},
		ACTIVE,
		mode,
	);
}

/** Scrolls the view from top to bottom (both views draw only the lines near the screen) and merges the images. */
async function collect(mode: Mode): Promise<Map<string, Shot>> {
	const out = new Map<string, Shot>();
	const sel = `${ACTIVE} ${mode === 'source' ? '.cm-scroller' : '.markdown-reading-view .markdown-preview-view'}`;
	for (let step = 0; step < 40; step++) {
		const more = await browser.execute(
			(q: string, i: number) => {
				const el = document.querySelector(q);
				if (!el) return false;
				el.scrollTop = i * Math.max(100, el.clientHeight / 2);
				return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
			},
			sel,
			step,
		);
		await browser.pause(250);
		for (const x of await shots(mode)) if (x.label && x.w > 0) out.set(x.label, x);
		if (!more) break;
	}
	await browser.execute((q: string) => {
		const el = document.querySelector(q);
		if (el) el.scrollTop = 0;
	}, sel);
	return out;
}

/** Waits until each label has a loaded image and two scans give the same sizes. */
async function stable(mode: Mode, labels: string[]): Promise<Map<string, Shot>> {
	let last = '';
	let out = new Map<string, Shot>();
	await browser.waitUntil(
		async () => {
			out = await collect(mode);
			const now = JSON.stringify(Array.from(out.entries()).sort());
			const ok = labels.every((l) => (out.get(l)?.w ?? 0) > 0) && now === last;
			last = now;
			return ok;
		},
		{ timeout: 40000, interval: 200, timeoutMsg: `images did not settle in ${mode}: ${last.slice(0, 600)}` },
	);
	return out;
}

function near(actual: number, expected: number, label: string): void {
	if (Math.abs(actual - expected) > 2) throw new Error(`${label}: ${actual} px, expected ${expected.toFixed(1)} px`);
}

function checkSizes(m: Map<string, Shot>, mode: string): void {
	const a = m.get('A')!;
	near(a.w, a.col * 0.5, `${mode} A 50%`);
	const b = m.get('B')!;
	near(b.w, b.col * 0.5, `${mode} B width 50% (${b.dbg})`);
	near(b.h, b.vh * 30, `${mode} B height 30% (30vh)`);
	const c = m.get('C')!;
	near(c.w, Math.min(c.rem * 20, c.col), `${mode} C 20rem`);
	const d = m.get('D')!;
	near(d.w, Math.min(d.em * 8, d.col), `${mode} D 8em`);
	const e = m.get('E')!;
	near(e.w, Math.min(e.vw * 40, e.col), `${mode} E 40vw`);
	const f = m.get('F')!;
	near(f.w, f.col * 0.5, `${mode} F markdown alt|50%`);
	expect(f.alt).toBe('alt');
	const h = m.get('H')!;
	near(h.w, h.col * 0.25, `${mode} H cap|25%`);
	expect(h.alt).toBe('cap');
	// Pixel size: core behavior, no mark and no style from the plugin.
	const g = m.get('G')!;
	expect([g.w, g.mark, g.style]).toEqual([200, null, '']);
	// No size: the natural size, limited by the column.
	const j = m.get('J')!;
	expect(j.mark).toBeNull();
	near(j.w, Math.min(800, j.col), `${mode} J natural`);
}

async function plugin<T>(fn: string, ...args: unknown[]): Promise<T> {
	return browser.executeObsidian(
		({ app }, id, f, a) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Record<string, unknown>> } }).plugins.plugins[id]!;
			if (f === 'set') {
				Object.assign(p.settings as object, a[0]);
				(p.refreshAll as () => void).call(p);
				return null;
			}
			if (f === 'passes') return (p.stats as { passes: number }).passes;
			if (f === 'stats') return { ...(p.stats as { passes: number; ms: number }) };
			return null;
		},
		pluginId,
		fn,
		args,
	) as Promise<T>;
}

async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, value) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				signOut(): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			if (!value) {
				p.pro.signOut();
				return;
			}
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		},
		pluginId,
		on,
	);
}

async function pluginOn(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, v) => {
		const plugins = (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean>; disablePlugin(id: string): Promise<void> } }).plugins;
		if (v) await plugins.enablePlugin(id);
		else await plugins.disablePlugin(id);
	}, pluginId, on);
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

describe(`${pluginId} in the real app`, function () {
	before(async function () {
		await browser.execute(() => {
			const w = window as unknown as { __riwErrors?: string[] };
			if (w.__riwErrors) return;
			const errors: string[] = [];
			w.__riwErrors = errors;
			const original = console.error;
			console.error = (...args: unknown[]) => {
				errors.push(args.map(String).join(' '));
				original(...args);
			};
			window.addEventListener('error', (e) => errors.push(String(e.message)));
			window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
		});
		await setPro(false);
		await plugin('set', { pandoc: false, defaultSize: '' });
		await obsidianPage.write('Sizes.md', SIZES);
		await browser.pause(500);
	});

	it('A1 A2 A3 A4 sizes relative tokens in Live Preview and keeps pixel sizes', async function () {
		await open('Sizes.md', 'source');
		checkSizes(await stable('source', LETTERS), 'live preview');
	});

	it('A1 A2 A3 A4 sizes relative tokens in Reading view and keeps pixel sizes', async function () {
		await open('Sizes.md', 'preview');
		checkSizes(await stable('preview', LETTERS), 'reading view');
	});

	it('A4 a pixel size is the same with the plugin off', async function () {
		await open('Sizes.md', 'source');
		await pluginOn(false);
		try {
			const m = await stable('source', LETTERS);
			expect(m.get('G')!.w).toBe(200);
			// A8: unload removes every size.
			for (const s of m.values()) expect(s.mark).toBeNull();
			near(m.get('A')!.w, Math.min(800, m.get('A')!.col), 'unloaded A natural');
			expect(m.get('H')!.alt).toBe('cap|25%');
		} finally {
			await pluginOn(true);
		}
		const back = (await stable('source', LETTERS)).get('A')!;
		near(back.w, back.col * 0.5, 'reloaded A 50%');
	});

	it('A5 MarkdownRenderer.render (the Reading view renderer) gives the sizes', async function () {
		const out = await browser.executeObsidian(async ({ app, obsidian }, text) => {
			const host = document.body.createDiv();
			host.setCssStyles({ width: '600px', position: 'absolute', left: '0', top: '0' });
			const c = new obsidian.Component();
			c.load();
			try {
				await obsidian.MarkdownRenderer.render(app, text, host, 'Sizes.md', c);
				for (let i = 0; i < 50 && host.querySelectorAll('img').length < 10; i++) await new Promise((r) => setTimeout(r, 100));
				await new Promise((r) => setTimeout(r, 300));
				return Array.from(host.querySelectorAll('img')).map((img) => ({ alt: img.getAttribute('alt'), width: img.style.width, height: img.style.height, attr: img.getAttribute('width') }));
			} finally {
				c.unload();
				host.remove();
			}
		}, SIZES);
		expect(out).toEqual([
			{ alt: 'wide.png', width: '50%', height: '', attr: null },
			{ alt: 'wide.png', width: '50%', height: '30vh', attr: null },
			{ alt: 'wide.png', width: '20rem', height: '', attr: null },
			{ alt: 'wide.png', width: '8em', height: '', attr: null },
			{ alt: 'wide.png', width: '40vw', height: '', attr: null },
			{ alt: 'alt', width: '50%', height: '', attr: null },
			{ alt: 'wide.png', width: '', height: '', attr: '200' },
			{ alt: 'cap', width: '25%', height: '', attr: null },
			{ alt: 'Image', width: '', height: '', attr: null },
			{ alt: 'wide.png', width: '', height: '', attr: null },
		]);
	});

	it('A6 Pandoc attributes: off by default, on in Reading view and Live Preview', async function () {
		await open('Sizes.md', 'preview');
		let m = await stable('preview', LETTERS);
		expect(m.get('I')!.mark).toBeNull();
		const text = () => browser.execute((sel: string) => Array.from(document.querySelectorAll(`${sel} .markdown-reading-view p`)).find((p) => (p.textContent ?? '').startsWith('I'))?.textContent ?? '', ACTIVE);
		expect(await text()).toContain('{width=30%}');
		await plugin('set', { pandoc: true });
		try {
			await browser.waitUntil(async () => !(await text()).includes('{width=30%}') || (await browser.execute(() => !!document.querySelector('.riw-hidden'))), { timeout: 10000, timeoutMsg: 'Pandoc text not hidden' });
			m = await stable('preview', LETTERS);
			near(m.get('I')!.w, m.get('I')!.col * 0.3, 'reading I pandoc 30%');
			const visible = await browser.execute(() => {
				const h = document.querySelector('.workspace-leaf.mod-active .riw-hidden');
				return h ? getComputedStyle(h).display : 'missing';
			});
			expect(visible).toBe('none');
			await open('Sizes.md', 'source');
			m = await stable('source', LETTERS);
			near(m.get('I')!.w, m.get('I')!.col * 0.3, 'live preview I pandoc 30%');
			const lineText = await browser.execute((sel: string) => Array.from(document.querySelectorAll(`${sel} .cm-content > .cm-line`)).find((l) => (l.textContent ?? '').startsWith('I'))?.textContent ?? '', ACTIVE);
			expect(lineText.includes('{width=30%}')).toBe(false);
		} finally {
			await plugin('set', { pandoc: false });
		}
	});

	it('A9 no layout loop with 200 images, and the pass time while typing', async function () {
		const many = Array.from({ length: 200 }, (_, i) => `Row ${i} ![[wide.png|${(i % 9) + 1}0%]]`).join('\n\n');
		await obsidianPage.write('Many.md', many);
		await browser.pause(300);
		await open('Many.md', 'source');
		await browser.pause(3000);
		const p1 = await plugin<number>('passes');
		await browser.pause(2000);
		const p2 = await plugin<number>('passes');
		expect(p2 - p1).toBeLessThanOrEqual(1);
		// Typing: 30 edits, one animation frame after each, so each edit gets its pass. Time the passes themselves.
		await plugin('set', { pandoc: true });
		const s0 = await plugin<{ passes: number; ms: number }>('stats');
		await browser.executeObsidian(async ({ app }) => {
			const e = app.workspace.activeEditor?.editor;
			if (!e) return;
			for (let i = 0; i < 30; i++) {
				e.replaceRange('x', { line: 0, ch: 0 });
				await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
			}
		});
		const s1 = await plugin<{ passes: number; ms: number }>('stats');
		await plugin('set', { pandoc: false });
		const passes = s1.passes - s0.passes;
		expect(passes).toBeGreaterThanOrEqual(30);
		// One pass over the 200-image note in the editor: under 8 ms on average.
		expect((s1.ms - s0.ms) / passes).toBeLessThan(8);
		await open('Many.md', 'preview');
		await browser.pause(2000);
		const sized = await browser.execute((sel: string) => document.querySelectorAll(`${sel} .markdown-reading-view img[data-riw]`).length, ACTIVE);
		expect(sized).toBeGreaterThan(0);
	});

	it('A10 Pro default size and the note property', async function () {
		const note = ['---', 'image-width: 10rem', '---', '', 'J ![[wide.png]]', '', 'G ![[wide.png|200]]', ''].join('\n');
		await obsidianPage.write('Pro.md', note);
		await browser.pause(500);
		await plugin('set', { defaultSize: '30%' });
		await open('Sizes.md', 'preview');
		let m = await stable('preview', LETTERS);
		expect(m.get('J')!.mark).toBeNull();
		await setPro(true);
		try {
			await browser.pause(500);
			m = await stable('preview', LETTERS);
			near(m.get('J')!.w, m.get('J')!.col * 0.3, 'pro default 30%');
			expect(m.get('G')!.style).toBe('');
			near(m.get('A')!.w, m.get('A')!.col * 0.5, 'token wins over the default');
			await open('Pro.md', 'source');
			m = await stable('source', ['J', 'G']);
			near(m.get('J')!.w, Math.min(m.get('J')!.rem * 10, m.get('J')!.col), 'note property 10rem');
			expect(m.get('G')!.w).toBe(200);
		} finally {
			await setPro(false);
			await plugin('set', { defaultSize: '' });
		}
		m = await stable('source', ['J', 'G']);
		expect(m.get('J')!.mark).toBeNull();
	});

	it('sizes images in a callout and in an embedded note, in both views', async function () {
		await obsidianPage.write('Inner.md', 'L ![[wide.png|30%]]\n');
		await obsidianPage.write('Nested.md', ['Top line.', '', '> [!note] Box', '> K ![[wide.png|50%]]', '', '![[Inner]]', '', 'End.'].join('\n'));
		await browser.pause(500);
		for (const mode of ['source', 'preview'] as const) {
			await open('Nested.md', mode);
			const m = await stable(mode, ['K', 'L']);
			near(m.get('K')!.w, m.get('K')!.col * 0.5, `${mode} callout 50%`);
			near(m.get('L')!.w, m.get('L')!.col * 0.3, `${mode} embedded note 30%`);
		}
	});

	it('B1 follows a size edited in place in Live Preview: 50%, 25%, 200, 30em', async function () {
		await obsidianPage.write('Edit.md', ['A ![[wide.png|50%]]', '', 'End.'].join('\n'));
		await browser.pause(400);
		await open('Edit.md', 'source');
		let m = await stable('source', ['A']);
		near(m.get('A')!.w, m.get('A')!.col * 0.5, 'edit 50%');
		for (const [token, check] of [
			['25%', (x: Shot) => near(x.w, x.col * 0.25, 'edit 25%')],
			['200', (x: Shot) => expect([x.w, x.mark, x.style]).toEqual([200, null, ''])],
			['30em', (x: Shot) => near(x.w, Math.min(x.em * 30, x.col), 'edit 30em')],
		] as const) {
			await browser.executeObsidian(({ app }, t) => {
				const e = app.workspace.activeEditor?.editor;
				if (!e) return;
				e.setLine(0, `A ![[wide.png|${t}]]`);
				e.setCursor({ line: e.lastLine(), ch: 0 });
			}, token);
			m = await stable('source', ['A']);
			check(m.get('A')!);
		}
	});

	it('B2 no scroll jump in a 300-image note (50 steps, none over 10 px)', async function () {
		const lines = Array.from({ length: 300 }, (_, i) => `Row ${String(i).padStart(3, '0')} ![[wide.png|${(i % 9) + 1}0%]]`).join('\n\n');
		await obsidianPage.write('Many300.md', lines + '\n\nEnd.');
		await browser.pause(500);
		await open('Many300.md', 'source');
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.setCursor({ line: 0, ch: 0 }));
		await browser.pause(2500);
		const drifts: number[] = [];
		for (const dir of [1, -1]) {
			for (let i = 0; i < 25; i++) {
				const r = await browser.execute(
					async (sel: string, d: number) => {
						const sc = document.querySelector(`${sel} .cm-scroller`) as HTMLElement;
						sc.scrollTop = sc.scrollTop + d * sc.clientHeight * 1.5;
						await new Promise((res) => requestAnimationFrame(() => res(null)));
						const top = sc.getBoundingClientRect().top;
						const lines = () => Array.from(sc.querySelectorAll('.cm-content > .cm-line')) as HTMLElement[];
						const l = lines().find((x) => x.getBoundingClientRect().top >= top + 20 && /Row/.test(x.textContent ?? ''));
						const key = l ? (l.textContent ?? '').slice(0, 7) : '';
						const y0 = l ? l.getBoundingClientRect().top : 0;
						await new Promise((res) => setTimeout(res, 600));
						const l2 = lines().find((x) => (x.textContent ?? '').slice(0, 7) === key);
						return { drift: l2 ? Math.round(l2.getBoundingClientRect().top - y0) : 0, atEnd: d > 0 ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2 : sc.scrollTop <= 0 };
					},
					ACTIVE,
					dir,
				);
				drifts.push(r.drift);
				if (r.atEnd) break;
			}
		}
		expect(drifts.length).toBeGreaterThanOrEqual(10);
		expect(drifts.filter((d) => Math.abs(d) > 10)).toEqual([]);
	});

	it('B3 Pandoc blocks in code and after a note or PDF embed stay text', async function () {
		const note = ['Top.', '', 'Code `![](wide.png){width=50%}` here', '', '```', '![](wide.png){width=40%}', '```', '', '![[Inner]]{width=30%}', '', '![[doc.pdf]]{width=20%}', '', 'P ![P](wide.png){width=30%}', '', 'End.'].join('\n');
		await obsidianPage.write('Mixed.md', note);
		await browser.pause(400);
		await plugin('set', { pandoc: true });
		try {
			await open('Mixed.md', 'source');
			const m = await stable('source', ['P']);
			near(m.get('P')!.w, m.get('P')!.col * 0.3, 'mixed P pandoc 30%');
			const text = await browser.execute((sel: string) => document.querySelector(`${sel} .cm-content`)?.textContent ?? '', ACTIVE);
			for (const block of ['{width=50%}', '{width=40%}', '{width=30%}', '{width=20%}']) expect(text).toContain(block);
			expect(text.split('{width=30%}').length - 1).toBe(1);
			await open('Mixed.md', 'preview');
			await stable('preview', ['P']);
			const rv = await browser.execute((sel: string) => document.querySelector(`${sel} .markdown-reading-view`)?.textContent ?? '', ACTIVE);
			for (const block of ['{width=50%}', '{width=40%}', '{width=30%}']) expect(rv).toContain(block);
		} finally {
			await plugin('set', { pandoc: false });
		}
	});

	it('B4 sizes an image in a table cell in both views', async function () {
		await obsidianPage.write('Table.md', ['Top.', '', '| a | b |', '| - | - |', '| ![[wide.png\\|50%]] | text |', '', 'End.'].join('\n'));
		await browser.pause(400);
		for (const mode of ['source', 'preview'] as const) {
			await open('Table.md', mode);
			let last = '';
			await browser.waitUntil(
				async () => {
					try {
					const r = await browser.execute((sel: string) => {
						const root = document.querySelector(`${sel} ${'.markdown-reading-view, .markdown-source-view'}`);
						const img = Array.from(document.querySelectorAll(`${sel} td img`)).find((x) => !x.classList.contains('cm-widgetBuffer') && (x as HTMLElement).offsetParent !== null) as HTMLImageElement | undefined;
						if (!img) return { w: 0, col: 0, mark: null, tds: document.querySelectorAll(`${sel} td`).length, root: root?.className ?? 'none' };
						// The percent is a share of the block that holds the embed in the cell.
						const box = (img?.closest('.internal-embed') ?? img)?.parentElement;
						if (!box) return null;
						const cs = getComputedStyle(box);
						return { w: img.getBoundingClientRect().width, col: box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), mark: img.getAttribute('data-riw') };
					}, ACTIVE);
					last = JSON.stringify(r);
					return !!r && r.w > 0 && r.mark !== null && Math.abs(r.w - r.col * 0.5) <= 2;
					} catch (e) {
						last = `error ${String(e)}`;
						return false;
					}
				},
				{ timeout: 15000, interval: 300, timeoutMsg: `table cell image in ${mode}: ${last}` },
			);
		}
	});

	it('logs no errors', async function () {
		const errors = await browser.execute(() => (window as unknown as { __riwErrors?: string[] }).__riwErrors?.splice(0) ?? []);
		expect(errors).toEqual([]);
	});
});
