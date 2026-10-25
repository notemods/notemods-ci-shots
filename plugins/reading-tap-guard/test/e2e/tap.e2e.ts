import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';

// Real-app checks for acceptance criteria A1 to A9 and A11 of the spec (lanes/B8/SPEC.md).
// wdio.conf.mts runs this file on Obsidian minAppVersion and latest, each on the desktop layout and with emulateMobile.
// Two kinds of touch input:
//  - synthetic: PointerEvent('pointerdown'/'pointerup', {pointerType: 'touch'}) dispatched at a point. Core reads
//    only pointerType, button, pointerId, clientX and clientY of these events (KILLGATE.md part b).
//  - trusted: WebDriver pointer actions with pointerType "touch". Chromium makes real touch input from them, with
//    its own pointer, touch and click events.
const NOTE = 'Tap test.md';
const PARA = 'Double tap this paragraph';

type Mode = 'preview' | 'source' | 'none';
interface Point {
	x: number;
	y: number;
}

async function mobile(): Promise<boolean> {
	return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
}

/** Opens the note in Reading view in the main area and waits until the paragraph is drawn. */
async function openReading(path = NOTE): Promise<void> {
	await browser.executeObsidian(async ({ app, obsidian }, p) => {
		const file = app.vault.getAbstractFileByPath(p);
		if (!(file instanceof obsidian.TFile)) throw new Error(`no file ${p}`);
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(file, { state: { mode: 'preview' }, active: true });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		window.getSelection()?.removeAllRanges();
	}, path);
	await browser.waitUntil(async () => (await mode()) === 'preview', { timeout: 10000, interval: 100 });
	await browser.waitUntil(
		() =>
			browser.executeObsidian(({ app, obsidian }, para) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
				const p = Array.from(view?.containerEl.querySelectorAll('.markdown-reading-view p') ?? []).find((el) => (el.textContent ?? '').startsWith(para));
				if (!p) return false;
				p.setAttribute('id', 'rtg-para');
				return true;
			}, PARA),
		{ timeout: 10000, interval: 100 },
	);
	// Core arms its tap counter on the first pointerdown. Start each test with a clean count and no selection.
	await browser.pause(700);
}

async function mode(): Promise<Mode> {
	return browser.executeObsidian(({ app, obsidian }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		return view ? (view.getMode() as Mode) : 'none';
	});
}

async function activePath(): Promise<string> {
	return browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path ?? '');
}

async function setSettings(action: string, interval = 500): Promise<void> {
	await browser.executeObsidian(
		({ app }, a, i) => {
			const all = (app as unknown as { plugins: { plugins: Record<string, { settings: { action: string; interval: number } }> } }).plugins.plugins;
			const p = all['reading-tap-guard'];
			if (!p) throw new Error('plugin not loaded');
			p.settings.action = a;
			p.settings.interval = i;
		},
		action,
		interval,
	);
}

async function setEnabled(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, enable) => {
		const plugins = (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean>; disablePlugin(id: string): Promise<void> } }).plugins;
		if (enable) await plugins.enablePlugin(id);
		else await plugins.disablePlugin(id);
	}, pluginId, on);
	await browser.pause(300);
}

/** Center of the word in the test paragraph, in client px. */
async function wordPoint(word: string): Promise<Point> {
	return browser.execute((w: string) => {
		const p = document.getElementById('rtg-para');
		const node = p?.firstChild;
		if (!p || !node || node.nodeType !== 3) throw new Error('no paragraph text');
		const i = (node.nodeValue ?? '').indexOf(w);
		const r = document.createRange();
		r.setStart(node, i);
		r.setEnd(node, i + w.length);
		const b = r.getBoundingClientRect();
		return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
	}, word);
}

/** Two synthetic touch taps at a point, 120 ms apart: pointerdown, pointerup and click on the element under the point. */
async function syntheticDoubleTap(pt: Point): Promise<void> {
	for (let i = 0; i < 2; i++) {
		await browser.execute((x: number, y: number, id: number) => {
			const el = document.elementFromPoint(x, y);
			if (!el) throw new Error('nothing at point');
			const init = { pointerType: 'touch', pointerId: id, button: 0, buttons: 1, isPrimary: true, bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
			el.dispatchEvent(new PointerEvent('pointerdown', init));
			el.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
			el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
		}, pt.x, pt.y, 40 + i);
		await browser.pause(120);
	}
}

/** WebDriver touch input: taps at a point (count 1 or 2, 120 ms apart). */
async function trustedTaps(pt: Point, count: number): Promise<void> {
	let chain = browser.action('pointer', { parameters: { pointerType: 'touch' } }).move({ x: pt.x, y: pt.y, origin: 'viewport', duration: 0 });
	for (let i = 0; i < count; i++) {
		chain = chain.down({ button: 0 }).pause(40).up({ button: 0 });
		if (i < count - 1) chain = chain.pause(120);
	}
	await chain.perform();
}

/** Starts a log of pointer, mouse and click events (capture phase on the window) for a failure message. */
async function startLog(): Promise<void> {
	await browser.execute(() => {
		const w = window as unknown as { rtgLog?: string[]; rtgOff?: () => void };
		w.rtgOff?.();
		const log: string[] = [];
		w.rtgLog = log;
		const t0 = performance.now();
		const types = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'change'];
		const cb = (e: Event): void => {
			const el = e.target as Element | null;
			const pe = e as PointerEvent;
			log.push(`${Math.round(performance.now() - t0)} ${e.type}${'pointerType' in e ? `/${pe.pointerType}` : ''} ${el?.tagName ?? ''}.${(el?.className ?? '').toString().slice(0, 30)} trusted=${e.isTrusted}`);
			window.setTimeout(() => log.push(`  ${e.type} defaultPrevented=${e.defaultPrevented} sel="${window.getSelection()?.toString() ?? ''}"`), 0);
		};
		const onSel = (): void => {
			log.push(`${Math.round(performance.now() - t0)} selectionchange "${window.getSelection()?.toString() ?? ''}"`);
		};
		for (const t of types) window.addEventListener(t, cb, true);
		document.addEventListener('selectionchange', onSel);
		w.rtgOff = () => {
			for (const t of types) window.removeEventListener(t, cb, true);
			document.removeEventListener('selectionchange', onSel);
		};
	});
}

async function readLog(): Promise<string> {
	return browser.execute(() => ((window as unknown as { rtgLog?: string[] }).rtgLog ?? []).join('\n'));
}

/** Mode 1 second after the input: core switches 100 ms after the second tap. */
async function modeAfter(): Promise<Mode> {
	await browser.pause(1000);
	return mode();
}

async function centerOf(selector: string): Promise<Point> {
	return browser.executeObsidian(({ app, obsidian }, sel) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		const el = view?.containerEl.querySelector(sel);
		if (!el) throw new Error(`no ${sel}`);
		const b = el.getBoundingClientRect();
		return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
	}, selector);
}

describe(`${pluginId} double tap in Reading view`, function () {
	before(async function () {
		await browser.waitUntil(() => browser.executeObsidian(({ app }, id) => !!(app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins[id], pluginId), { timeout: 10000 });
		console.log(`[rtg] layout ${(await mobile()) ? 'mobile emulation' : 'desktop'}`);
	});

	afterEach(async function () {
		await setEnabled(true);
		await setSettings('nothing');
	});

	it('positive control: without the plugin a synthetic touch double tap switches to editing (A1, A11)', async function () {
		await setEnabled(false);
		await openReading();
		await syntheticDoubleTap(await wordPoint('paragraph'));
		expect(await modeAfter()).toBe('source');
	});

	it('positive control: without the plugin a trusted touch double tap switches to editing (A1)', async function () {
		await setEnabled(false);
		await openReading();
		await trustedTaps(await wordPoint('paragraph'), 2);
		expect(await modeAfter()).toBe('source');
	});

	it('default blocks: with the plugin a synthetic touch double tap keeps Reading view (A2)', async function () {
		await openReading();
		await syntheticDoubleTap(await wordPoint('paragraph'));
		expect(await modeAfter()).toBe('preview');
	});

	it('default blocks: with the plugin a trusted touch double tap keeps Reading view (A2)', async function () {
		await openReading();
		await trustedTaps(await wordPoint('paragraph'), 2);
		expect(await modeAfter()).toBe('preview');
	});

	it('default blocks: four quick taps keep Reading view (A2)', async function () {
		await openReading();
		await trustedTaps(await wordPoint('paragraph'), 4);
		expect(await modeAfter()).toBe('preview');
	});

	it('link tap: one trusted touch tap on an internal link opens the note (A3)', async function () {
		await openReading();
		await trustedTaps(await centerOf('a.internal-link[data-href="Target"]'), 1);
		await browser.waitUntil(async () => (await activePath()) === 'Target.md', { timeout: 5000, interval: 100, timeoutMsg: 'the link did not open Target.md' });
	});

	for (const withPlugin of [false, true]) {
		it(`checkbox tap: one trusted touch tap on a task checkbox checks the task, plugin ${withPlugin ? 'on (A4)' : 'off (control)'}`, async function () {
			await setEnabled(withPlugin);
			await openReading();
			await startLog();
			await trustedTaps(await centerOf('input.task-list-item-checkbox'), 1);
			await browser
				.waitUntil(() => browser.executeObsidian(async ({ app }, p) => (await app.vault.adapter.read(p)).includes('- [x] Buy milk'), NOTE), { timeout: 6000, interval: 100 })
				.catch(async () => {
					throw new Error(`the task was not checked. Events:\n${await readLog()}`);
				});
			await browser.executeObsidian(async ({ app }, p) => {
				const text = await app.vault.adapter.read(p);
				await app.vault.adapter.write(p, text.replace('- [x] Buy milk', '- [ ] Buy milk'));
			}, NOTE);
			await browser.pause(800);
		});
	}

	it('scroll: a trusted touch drag scrolls the Reading view (A5)', async function () {
		await openReading();
		const box = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			const el = view?.containerEl.querySelector('.markdown-reading-view .markdown-preview-view');
			if (!el) throw new Error('no preview scroller');
			el.scrollTop = 0;
			const b = el.getBoundingClientRect();
			const top = Math.max(b.top, 0);
			const height = Math.min(b.bottom, window.innerHeight) - top;
			return { x: Math.round(b.left + b.width / 2), top: Math.round(top + height * 0.25), bottom: Math.round(top + height * 0.7), inner: [window.innerWidth, window.innerHeight] };
		});
		const from = { x: box.x, y: box.bottom };
		await browser
			.action('pointer', { parameters: { pointerType: 'touch' } })
			.move({ x: from.x, y: from.y, origin: 'viewport', duration: 0 })
			.down({ button: 0 })
			.move({ x: from.x, y: box.top, origin: 'viewport', duration: 400 })
			.up({ button: 0 })
			.perform();
		await browser.pause(600);
		const top = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			return view?.containerEl.querySelector('.markdown-reading-view .markdown-preview-view')?.scrollTop ?? -1;
		});
		if (top <= 50) throw new Error(`scrollTop ${top}, box ${JSON.stringify(box)}`);
		expect(await mode()).toBe('preview');
	});

	it('edit button and command: both still switch modes with the plugin (A6)', async function () {
		await openReading();
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView) as unknown as { modeButtonEl: HTMLElement };
			view.modeButtonEl.click();
		});
		await browser.waitUntil(async () => (await mode()) === 'source', { timeout: 5000, interval: 100, timeoutMsg: 'the edit button did not switch to editing' });
		await browser.executeObsidian(({ app }) => (app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById('markdown:toggle-preview'));
		await browser.waitUntil(async () => (await mode()) === 'preview', { timeout: 5000, interval: 100, timeoutMsg: 'the command did not switch to Reading view' });
		await browser.executeObsidian(({ app }) => (app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById('markdown:toggle-preview'));
		await browser.waitUntil(async () => (await mode()) === 'source', { timeout: 5000, interval: 100, timeoutMsg: 'the command did not switch to editing' });
	});

	it('switch to editing setting: the double tap switches to editing again (A7)', async function () {
		await setSettings('edit');
		await openReading();
		await trustedTaps(await wordPoint('paragraph'), 2);
		expect(await modeAfter()).toBe('source');
		await openReading();
		await syntheticDoubleTap(await wordPoint('paragraph'));
		expect(await modeAfter()).toBe('source');
	});

	it('select word setting: the double tap selects the word and keeps Reading view (A8)', async function () {
		await setSettings('select-word');
		await openReading();
		await syntheticDoubleTap(await wordPoint('quick'));
		expect(await modeAfter()).toBe('preview');
		expect(await browser.execute(() => window.getSelection()?.toString() ?? '')).toBe('quick');
		await browser.execute(() => window.getSelection()?.removeAllRanges());
		await openReading();
		await startLog();
		await trustedTaps(await wordPoint('brown'), 2);
		expect(await modeAfter()).toBe('preview');
		const sel = await browser.execute(() => window.getSelection()?.toString() ?? '');
		if (sel !== 'brown') throw new Error(`selection "${sel}". Events:\n${await readLog()}`);
		await browser.execute(() => window.getSelection()?.removeAllRanges());
	});

	it('positive control again after the plugin is turned off and on (A11)', async function () {
		await setEnabled(false);
		await setEnabled(true);
		await openReading();
		await syntheticDoubleTap(await wordPoint('paragraph'));
		expect(await modeAfter()).toBe('preview');
		await setEnabled(false);
		await openReading();
		await syntheticDoubleTap(await wordPoint('paragraph'));
		expect(await modeAfter()).toBe('source');
	});
});
