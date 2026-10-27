import { Notice, Plugin, TFile, normalizePath, type Editor } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { PRO_FOLDER, PRO_NAMED, SPONSORS, bindPro, isPro, proNotice, resetPro, proText } from './pro';
import { makeReview, validateProse, type Review } from './review';
import { DEFAULT_SETTINGS, assertMatch, folderOf, loadState, type Baseline, type StoredState } from './state';
import { RevisionSessionMarksSettingTab } from './settings';
import { ReviewModal, SessionModal } from './ui';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class RevisionSessionMarksPlugin extends Plugin {
	settings = { ...DEFAULT_SETTINGS };
	state: StoredState = loadState(null);
	pro: SponsorsManager | null = null;
	lastMessage = '';
	private busy = false;
	private tab: RevisionSessionMarksSettingTab | null = null;
	private modal: ReviewModal | SessionModal | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.tab = new RevisionSessionMarksSettingTab(this.app, this);
		this.addSettingTab(this.tab);
		this.register(pro.onChange(() => this.tab?.update()));
		this.register(() => this.modal?.close());
		this.addEditorCommand('start-session', 'Start a writing session', (file, text) => this.startSession(file, text));
		this.addEditorCommand('stop-session', 'Stop session and create a review note', (file, text) => this.stopSession(file, text));
		this.addEditorCommand('save-named-baseline', 'Save a named baseline (Pro)', (file, text) => this.saveNamed(file, text), PRO_NAMED);
		this.addEditorCommand('review-named-baseline', 'Create a named baseline review (Pro)', (file, text) => this.reviewNamed(file, text), PRO_NAMED);
		this.addEditorCommand('review-folder', 'Create folder reviews (Pro)', (file, text) => this.reviewFolder(file, text), PRO_FOLDER);
		this.addEditorCommand('remove-named-baseline', 'Remove the selected named baseline', (file) => this.removeNamed(file));
		this.addCommand({ id: 'show-session', name: 'Show session and baselines', callback: () => this.showSession() });
		this.addCommand({ id: 'remove-invalid-baselines', name: 'Remove invalid named baselines', callback: () => this.run(() => this.removeInvalid()) });
		this.addCommand({ id: 'discard-session', name: 'Discard the writing baseline', callback: () => this.run(() => this.discardSession()) });
		this.registerEvent(this.app.vault.on('rename', (_file, oldPath) => { void this.invalidate(oldPath); }));
		this.registerEvent(this.app.vault.on('delete', (file) => { void this.invalidate(file.path); }));
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}

	onunload(): void { resetPro(); }

	/** proLead marks a Pro command: a free user gets the shared Pro notice and the action does not run. */
	private addEditorCommand(id: string, name: string, action: (file: TFile, text: string) => Promise<unknown>, proLead?: string): void {
		this.addCommand({ id, name, editorCallback: (editor: Editor, ctx) => {
			// The session window shows the same text as its last message.
			if (proLead && !isPro()) { this.lastMessage = proText(proLead); proNotice(proLead); return; }
			const file = ctx.file;
			const text = editor.getValue();
			return this.run(async () => {
				if (!file || file !== this.app.workspace.getActiveFile()) throw new Error('Open an active plain prose note first.');
				await action(file, text);
			});
		} });
	}

	async run(action: () => Promise<unknown>): Promise<void> {
		try { await action(); }
		catch (e) { this.tell(e instanceof Error ? e.message : String(e)); }
	}

	private async exclusive<T>(action: () => Promise<T>): Promise<T> {
		if (this.busy) throw new Error('A revision action is in progress. Wait for it to finish.');
		this.busy = true;
		try { return await action(); }
		finally { this.busy = false; }
	}

	tell(message: string): void {
		this.lastMessage = message;
		new Notice(message);
	}

	async loadSettings(): Promise<void> {
		this.state = loadState(await this.loadData() as unknown);
		this.settings = this.state.settings;
	}

	async saveSettings(): Promise<void> {
		this.state.settings = this.settings;
		await this.saveData(this.state);
	}

	private async commitState(next: StoredState): Promise<void> {
		await this.saveData({ ...next, settings: this.settings });
		this.state = { ...next, settings: this.settings };
	}

	private capture(file: TFile, text: string, name = ''): Baseline {
		if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error('Start requires a note in this vault.');
		if (file.extension !== 'md') throw new Error('Start requires a Markdown file with plain prose.');
		validateProse(text, 'baseline');
		return { path: file.path, text, ctime: file.stat.ctime, invalid: false, name };
	}

	private match(b: Baseline, file: TFile): void {
		const stored = this.app.vault.getAbstractFileByPath(b.path);
		assertMatch(b, stored instanceof TFile && stored === file ? { path: file.path, ctime: file.stat.ctime } : null);
	}

	private stale(b: Baseline): boolean {
		const file = this.app.vault.getAbstractFileByPath(b.path);
		try { if (file instanceof TFile) { this.match(b, file); return false; } }
		catch { /* A mismatch makes the baseline stale. */ }
		return true;
	}

	private needPro(): void {
		if (!isPro()) throw new Error(proText('This feature needs Pro.'));
	}

	private review(b: Baseline, text: string): Review {
		return makeReview(b.text, text, isPro() ? { author: this.settings.author, summary: this.settings.includeSummary } : {});
	}

	async startSession(file: TFile, text: string): Promise<void> {
		await this.exclusive(async () => {
			if (this.state.session) throw new Error('A session baseline is already saved. Stop or discard it before you start another session.');
			const session = this.capture(file, text);
			await this.commitState({ ...this.state, session });
			this.tell(`Baseline saved for ${file.path}. Edit this note, then stop the session.`);
		});
	}

	async stopSession(file: TFile, text: string): Promise<TFile | null> {
		return this.exclusive(async () => {
			const baseline = this.state.session;
			if (!baseline) throw new Error('No session baseline. Start a writing session first.');
			this.match(baseline, file);
			const review = this.review(baseline, text);
			if (!review.changed) { this.tell('No changes.'); return null; }
			const output = await this.writeReview(file, review);
			try { this.match(baseline, file); await this.commitState({ ...this.state, session: null }); }
			catch (e) { await this.removeOutput(output); throw e; }
			this.showReview(output, review);
			return output;
		});
	}

	async discardSession(): Promise<void> {
		await this.exclusive(async () => {
			await this.commitState({ ...this.state, session: null });
			this.tell('Session baseline discarded. Source note kept.');
		});
	}

	async saveNamed(file: TFile, text: string): Promise<void> {
		await this.exclusive(async () => {
			this.needPro();
			const name = this.settings.baselineName.trim();
			if (!name) throw new Error('Set a baseline name in the plugin settings.');
			if (this.state.named.some((b) => b.path === file.path && b.name === name)) throw new Error('This named baseline exists. Remove it before you save a replacement.');
			if (this.state.named.length >= 50) throw new Error('Named baseline limit: 50. Remove a baseline first.');
			const b = this.capture(file, text, name);
			await this.commitState({ ...this.state, named: [...this.state.named, b] });
			this.tell(`Named baseline saved: ${name}, ${file.path}.`);
		});
	}

	async removeNamed(file: TFile): Promise<void> {
		await this.exclusive(async () => {
			const named = this.state.named.filter((b) => b.path !== file.path || b.name !== this.settings.baselineName.trim());
			if (named.length === this.state.named.length) { this.tell('No selected named baseline for this note.'); return; }
			await this.commitState({ ...this.state, named });
			this.tell('Selected named baseline removed. Source note kept.');
		});
	}

	/** A renamed or deleted note has no file at the saved path, so its baseline cannot be removed from that note. */
	async removeInvalid(): Promise<void> {
		await this.exclusive(async () => {
			const named = this.state.named.filter((b) => !this.stale(b));
			const count = this.state.named.length - named.length;
			if (count) await this.commitState({ ...this.state, named });
			this.tell(`Removed ${count} invalid named ${count === 1 ? 'baseline' : 'baselines'}. Source notes kept.`);
		});
	}

	async reviewNamed(file: TFile, text: string): Promise<TFile | null> {
		return this.exclusive(async () => {
			this.needPro();
			const b = this.state.named.find((b) => b.path === file.path && b.name === this.settings.baselineName.trim());
			if (!b) throw new Error('Baseline file does not match. No selected named baseline for this note.');
			this.match(b, file);
			const review = this.review(b, text);
			if (!review.changed) { this.tell('No changes.'); return null; }
			const output = await this.writeReview(file, review);
			this.showReview(output, review);
			return output;
		});
	}

	/** Preflight this folder's selected named baselines before the first write. */
	async reviewFolder(active: TFile, activeText: string): Promise<TFile[]> {
		return this.exclusive(async () => {
			this.needPro();
			const folder = folderOf(active.path);
			const baselines = this.state.named.filter((b) => folderOf(b.path) === folder && b.name === this.settings.baselineName.trim());
			if (!baselines.length) throw new Error('No selected named baselines in this folder.');
			const plans: { file: TFile; review: Review }[] = [];
			for (const b of baselines) {
				const file = this.app.vault.getAbstractFileByPath(b.path);
				if (!(file instanceof TFile) || this.stale(b)) throw new Error(`Baseline file does not match: ${b.path}. No folder output. Run "Remove invalid named baselines" to remove it.`);
				const text = file === active ? activeText : await this.app.vault.read(file);
				const review = this.review(b, text);
				if (review.changed) plans.push({ file, review });
			}
			const outputs: TFile[] = [];
			try {
				for (const p of plans) {
					const b = baselines.find((b) => b.path === p.file.path)!;
					this.match(b, p.file);
					outputs.push(await this.writeReview(p.file, p.review));
				}
			} catch (e) {
				for (const output of outputs) await this.removeOutput(output);
				throw e;
			}
			this.tell(outputs.length ? `Created ${outputs.length} folder review notes. Named baselines kept.` : 'No changes.');
			if (outputs[0] && plans[0]) this.showReview(outputs[0], plans[0].review, outputs.map((f) => f.path));
			return outputs;
		});
	}

	/** Remove only an output made by this action when its transaction fails. */
	private async removeOutput(file: TFile): Promise<void> {
		await this.app.fileManager.trashFile(file);
	}

	private async writeReview(file: TFile, review: Review): Promise<TFile> {
		const base = normalizePath(`${file.path.slice(0, -3)} review`);
		for (let n = 1; n <= 1000; n++) {
			const path = `${base}${n === 1 ? '' : ` ${n}`}.md`;
			if (!this.app.vault.getAbstractFileByPath(path)) return this.app.vault.create(path, review.text);
		}
		throw new Error('Review file name limit reached. No output. Baseline kept.');
	}

	private async invalidate(path: string): Promise<void> {
		const affected = (b: Baseline) => b.path === path || b.path.startsWith(`${path}/`);
		const baselines = [this.state.session, ...this.state.named];
		if (!baselines.some((b) => b && affected(b))) return;
		// Mark immediately so a stop cannot race a rename or deletion.
		for (const b of baselines) if (b && affected(b)) b.invalid = true;
		await this.run(() => this.saveSettings());
	}

	showSession(): void {
		this.modal?.close();
		this.modal = new SessionModal(this.app, this.state, this.lastMessage);
		this.modal.open();
	}

	private showReview(file: TFile, review: Review, paths: string[] = [file.path]): void {
		this.tell(`Review saved: ${file.path}. Accept and reject checks passed.`);
		this.modal?.close();
		this.modal = new ReviewModal(this.app, file, review, paths);
		this.modal.open();
	}
}
