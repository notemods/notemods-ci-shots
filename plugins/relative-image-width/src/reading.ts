// Reading view and PDF export: a Markdown post processor. PDF export renders the note with the same post processors.
import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian';
import { sizeAll, type PassContext } from './dom';
import type { Options } from './settings';
import { NOTE_PROPERTY } from './settings';

/** How long a section waits for its image embeds to load. After this, the observer stops. */
export const WAIT_MS = 10_000;

/**
 * Watches one rendered section until its image embeds have loaded. Obsidian loads an image embed after the post
 * processor runs, so the first pass can find the embed with no image in it yet. The observer sees only this section,
 * only added nodes, and it stops after WAIT_MS or when the section unloads.
 */
class SectionWatch extends MarkdownRenderChild {
	private observer: MutationObserver | null = null;
	private frame = 0;
	private timer = 0;

	constructor(
		el: HTMLElement,
		private readonly pass: () => void,
	) {
		super(el);
	}

	onload(): void {
		const win = this.containerEl.ownerDocument.defaultView ?? window;
		this.observer = new MutationObserver(() => {
			if (this.frame) return;
			this.frame = win.requestAnimationFrame(() => {
				this.frame = 0;
				this.pass();
			});
		});
		this.observer.observe(this.containerEl, { childList: true, subtree: true });
		this.timer = win.setTimeout(() => this.stop(), WAIT_MS);
	}

	private stop(): void {
		const win = this.containerEl.ownerDocument.defaultView ?? window;
		this.observer?.disconnect();
		this.observer = null;
		if (this.frame) win.cancelAnimationFrame(this.frame);
		this.frame = 0;
		if (this.timer) win.clearTimeout(this.timer);
		this.timer = 0;
	}

	onunload(): void {
		this.stop();
	}
}

/**
 * Makes the post processor. options() gives the settings in effect at the time of the render, or null after the
 * plugin unloaded (a watch that is still waiting then does nothing).
 */
export function readingProcessor(options: () => Options | null) {
	return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		const opts = options();
		if (!opts) return;
		const frontmatter = ctx.frontmatter as Record<string, unknown> | null | undefined;
		const pass: PassContext = { opts, property: frontmatter?.[NOTE_PROPERTY] };
		const run = () => {
			if (options()) sizeAll(el, pass);
		};
		run();
		// Obsidian loads an image embed after this call, and it can put a new image element in place of the first one.
		// Watch a section with an image or an embed until WAIT_MS.
		if (el.querySelector('img, .internal-embed')) ctx.addChild(new SectionWatch(el, run));
	};
}
