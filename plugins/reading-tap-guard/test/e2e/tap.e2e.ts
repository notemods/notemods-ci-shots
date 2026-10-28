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
				if (!p) {
					// A test that scrolled far down leaves the top sections unrendered. Go back to the top.
					const scroller = view?.containerEl.querySelector('.markdown-reading-view .markdown-preview-view');
					if (scroller) scroller.scrollTop = 0;
					return false;
				}
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

/**
 * A synthetic tap that the browser cancels for a scroll: pointerdown, pointercancel, then touchend.
 * The touchend carries changedTouches with identifier = pointerId, the same id that core compares.
 * The test (not the plugin) defines changedTouches on a plain Event, because TouchEvent may not exist on Linux CI.
 */
async function cancelledTap(pt: Point, id: number): Promise<void> {
	await browser.execute((x: number, y: number, pid: number) => {
		const el = document.elementFromPoint(x, y);
		if (!el) throw new Error('nothing at point');
		const init = { pointerType: 'touch', pointerId: pid, button: 0, buttons: 1, isPrimary: true, bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
		el.dispatchEvent(new PointerEvent('pointerdown', init));
		el.dispatchEvent(new PointerEvent('pointercancel', { ...init, cancelable: false }));
		const end = new Event('touchend', { bubbles: true, cancelable: false });
		Object.defineProperty(end, 'changedTouches', { value: [{ identifier: pid, clientX: x, clientY: y, target: el }] });
		Object.defineProperty(end, 'touches', { value: [] });
		el.dispatchEvent(end);
	}, pt.x, pt.y, id);
	await browser.pause(120);
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
		await trustedTaps(await centerOf('.markdown-reading-view a.internal-link[data-href="Target"]'), 1);
		await browser.waitUntil(async () => (await activePath()) === 'Target.md', { timeout: 5000, interval: 100, timeoutMsg: 'the link did not open Target.md' });
	});

	for (const withPlugin of [false, true]) {
		it(`checkbox tap: one trusted touch tap on a task checkbox checks the task, plugin ${withPlugin ? 'on (A4)' : 'off (control)'}`, async function () {
			await setEnabled(withPlugin);
			await openReading();
			await startLog();
			await trustedTaps(await centerOf('.markdown-reading-view input.task-list-item-checkbox'), 1);
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
	it('scroll-cancelled taps: positive control without the plugin, two of them switch to editing (rule 12)', async function () {
		await setEnabled(false);
		await openReading();
		const pt = await wordPoint('paragraph');
		await cancelledTap(pt, 71);
		await cancelledTap(pt, 72);
		expect(await modeAfter()).toBe('source');
	});

	it('scroll-cancelled tap: with the plugin, a cancelled tap and then one tap keep Reading view (rule 12, Obsidian 1.14 and later)', async function () {
		// Obsidian 1.13.4 also counts the pointercancel itself as a tap and has no focusout reset, so rule 12 cannot
		// work there (README FAQ). The test runs on the versions where core resets its count on focusout.
		if (!(await browser.executeObsidian(({ obsidian }) => obsidian.requireApiVersion('1.14.0')))) this.skip();
		await openReading();
		const pt = await wordPoint('paragraph');
		await cancelledTap(pt, 73);
		await cancelledTap(pt, 74);
		expect(await modeAfter()).toBe('preview');
		await cancelledTap(pt, 75);
		await syntheticDoubleTap(pt);
		expect(await modeAfter()).toBe('preview');
		await cancelledTap(pt, 76);
		await trustedTaps(pt, 1);
		expect(await modeAfter()).toBe('preview');
	});

	it('scroll-cancelled tap: with Switch to editing, a real double tap still switches (rule 12)', async function () {
		await setSettings('edit');
		await openReading();
		const pt = await wordPoint('paragraph');
		await cancelledTap(pt, 77);
		await browser.pause(700);
		await trustedTaps(pt, 2);
		expect(await modeAfter()).toBe('source');
	});

	it('tag tap: one trusted touch tap on a tag opens the tag search', async function () {
		await openReading();
		await trustedTaps(await centerOf('.markdown-reading-view a.tag'), 1);
		await browser.waitUntil(
			() =>
				browser.executeObsidian(({ app }) =>
					app.workspace.getLeavesOfType('search').some((l) => String((l.getViewState().state as { query?: string } | undefined)?.query ?? '').includes('tag:#reading')),
				),
			{ timeout: 5000, interval: 100, timeoutMsg: 'the tag tap did not open the tag search' },
		);
		expect(await modeAfter()).not.toBe('source');
	});

	it('footnote tap: one trusted touch tap on a footnote reference scrolls to the footnote', async function () {
		await openReading();
		const before = await browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.containerEl.querySelector('.markdown-reading-view .markdown-preview-view')?.scrollTop ?? -1);
		await trustedTaps(await centerOf('.markdown-reading-view sup a.footnote-link, .markdown-reading-view a.footnote-link'), 1);
		await browser.waitUntil(
			async () =>
				(await browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.containerEl.querySelector('.markdown-reading-view .markdown-preview-view')?.scrollTop ?? -1)) > before + 200,
			{ timeout: 5000, interval: 100, timeoutMsg: 'the footnote tap did not scroll to the footnote' },
		);
		expect(await mode()).toBe('preview');
	});

	it('callout fold tap: one trusted touch tap on the fold icon opens the folded callout', async function () {
		await openReading();
		const collapsed = () =>
			browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.containerEl.querySelector('.markdown-reading-view .callout')?.classList.contains('is-collapsed') ?? null);
		expect(await collapsed()).toBe(true);
		await trustedTaps(await centerOf('.markdown-reading-view .callout .callout-fold'), 1);
		await browser.waitUntil(async () => (await collapsed()) === false, { timeout: 5000, interval: 100, timeoutMsg: 'the callout did not open' });
		expect(await mode()).toBe('preview');
	});

	it('popout: a popout that is open when the plugin loads is guarded (rule 11)', async function () {
		if (await mobile()) this.skip();
		const opened = await browser.executeObsidian(async ({ app, obsidian }, p) => {
			const file = app.vault.getAbstractFileByPath(p);
			if (!(file instanceof obsidian.TFile)) throw new Error('no file');
			const leaf = app.workspace.openPopoutLeaf();
			await leaf.openFile(file, { state: { mode: 'preview' } });
			await new Promise((r) => setTimeout(r, 1500));
			return leaf.view.containerEl.win !== window;
		}, NOTE);
		expect(opened).toBe(true);
		/** Double tap in the popout with its own event constructors; gives the mode of the popout view 1 s later. */
		const popoutDoubleTap = () =>
			browser.executeObsidian(async ({ app, obsidian }, p) => {
				const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.containerEl.win !== window && l.view instanceof obsidian.MarkdownView && l.view.file?.path === p);
				if (!leaf || !(leaf.view instanceof obsidian.MarkdownView)) throw new Error('no popout leaf');
				const view = leaf.view;
				if (view.getMode() !== 'preview') {
					const st = leaf.getViewState();
					await leaf.setViewState({ ...st, state: { ...st.state, mode: 'preview' } });
					await new Promise((r) => setTimeout(r, 800));
				}
				const win = view.containerEl.win as Window & typeof globalThis;
				const doc = win.document;
				const para = Array.from(view.containerEl.querySelectorAll('.markdown-reading-view p')).find((e) => (e.textContent ?? '').startsWith('Double tap'));
				const node = para?.firstChild;
				if (!node) throw new Error('no paragraph in popout');
				const r = doc.createRange();
				r.setStart(node, 30);
				r.setEnd(node, 31);
				const b = r.getBoundingClientRect();
				const x = b.left + b.width / 2;
				const y = b.top + b.height / 2;
				win.getSelection()?.removeAllRanges();
				await new Promise((res) => setTimeout(res, 700));
				for (let i = 0; i < 2; i++) {
					const el = doc.elementFromPoint(x, y);
					if (!el) throw new Error('nothing at point in popout');
					const init = { pointerType: 'touch', pointerId: 90 + i, button: 0, buttons: 1, isPrimary: true, bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
					el.dispatchEvent(new win.PointerEvent('pointerdown', init));
					el.dispatchEvent(new win.PointerEvent('pointerup', { ...init, buttons: 0 }));
					el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
					await new Promise((res) => setTimeout(res, 120));
				}
				await new Promise((res) => setTimeout(res, 1000));
				return view.getMode();
			}, NOTE);
		try {
			await setEnabled(false);
			expect(await popoutDoubleTap()).toBe('source');
			// The plugin loads while the popout is open.
			await setEnabled(true);
			expect(await popoutDoubleTap()).toBe('preview');
		} finally {
			await browser.executeObsidian(({ app }) => {
				for (const l of app.workspace.getLeavesOfType('markdown')) if (l.view.containerEl.win !== window) l.detach();
			});
			await browser.pause(500);
		}
	});
});
