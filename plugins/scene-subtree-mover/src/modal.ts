import { Modal, Notice, Setting, type App } from 'obsidian';
import type SceneSubtreeMoverPlugin from './main';
import type { OrderPreview } from './main';
import { isPro, onProChange } from './pro';
import { containsPath, moveSubtree, readTree, sameOrder, sceneChoices, siblingGroup, treeLines, writeTree } from './tree';

export class SceneMoverModal extends Modal {
	private selected: number[] = [0];
	private position = 0;
	private parent: number[] = [];
	private moves = 0;
	private orderName = '';
	private savedName = '';
	private status = 'Select a chapter, its destination parent, and its final position. Preview before you apply.';
	private pending = false;
	private complete = false;
	private proOpen = false;
	private stopPro: (() => void) | null = null;

	constructor(app: App, private readonly plugin: SceneSubtreeMoverPlugin, private readonly preview: OrderPreview, private readonly closed: () => void) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('scene-subtree-mover-modal');
		this.setTitle('Move a chapter with its scenes');
		this.stopPro = onProChange(() => this.render());
		this.render();
	}

	onClose(): void {
		this.stopPro?.();
		this.contentEl.empty();
		this.closed();
	}

	private async run(action: () => Promise<void> | void): Promise<void> {
		if (this.pending || this.complete) return;
		this.pending = true;
		this.render();
		try {
			await action();
		} catch (error) {
			this.status = error instanceof Error ? error.message : String(error);
			new Notice(this.status, 10000);
		} finally {
			this.pending = false;
			if (this.contentEl.isConnected) this.render();
		}
	}

	private stage(): void {
		if (this.moves > 0) this.plugin.requirePro();
		const next = moveSubtree(this.preview.after, { path: this.selected, parent: this.parent, position: this.position });
		if (sameOrder(next, this.preview.after)) {
			this.status = sameOrder(this.preview.before, this.preview.after)
				? 'The order is unchanged. No write or backup is needed.'
				: 'No move added. Previous preview changes remain. Check the resulting order before Apply.';
			return;
		}
		this.preview.after = next;
		this.moves++;
		this.preview.proAction = this.moves > 1;
		this.status = `${this.moves} move${this.moves === 1 ? '' : 's'} in the preview. Check the full resulting order before Apply.`;
		this.selected = [0];
		this.position = 0;
		this.parent = [];
	}

	private button(container: HTMLElement, action: string, label: string, disabled: boolean, fn: () => Promise<void> | void, cta = false): void {
		new Setting(container).addButton((button) => {
			button.setButtonText(label).setDisabled(disabled || this.pending || this.complete).onClick(() => this.run(fn));
			button.buttonEl.dataset.action = action;
			if (cta) button.setCta();
		}).settingEl.addClass('ssm-button-row');
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		el.createEl('p', { text: this.preview.path, cls: 'ssm-index-path' });
		const controls = el.createDiv('ssm-controls');
		const choices = sceneChoices(this.preview.after);
		new Setting(controls).setName('Chapter or scene').addDropdown((dropdown) => {
			dropdown.selectEl.dataset.field = 'chapter';
			for (const choice of choices) dropdown.addOption(JSON.stringify(choice.path), choice.label);
			dropdown.setValue(JSON.stringify(this.selected)).setDisabled(!choices.length || this.pending || this.complete).onChange((value) => {
				this.selected = JSON.parse(value) as number[];
				this.position = this.selected[this.selected.length - 1]!;
				this.parent = this.selected.slice(0, -1);
				this.render();
			});
		});
		new Setting(controls).setName('Destination parent').setDesc('The complete subtree moves with the selected scene.').addDropdown((dropdown) => {
			dropdown.selectEl.dataset.field = 'parent';
			dropdown.addOption('[]', 'Manuscript root');
			for (const choice of choices) {
				if (!containsPath(this.selected, choice.path)) dropdown.addOption(JSON.stringify(choice.path), choice.label);
			}
			dropdown.setValue(JSON.stringify(this.parent)).setDisabled(!choices.length || this.pending || this.complete).onChange((value) => {
				this.parent = JSON.parse(value) as number[];
				this.position = JSON.stringify(this.parent) === JSON.stringify(this.selected.slice(0, -1)) ? this.selected[this.selected.length - 1]! : 0;
				this.render();
			});
		});
		const group = this.parent.length ? (siblingGroup(this.preview.after, this.parent)[this.parent[this.parent.length - 1]!]!.children ?? []) : this.preview.after;
		const sameParent = JSON.stringify(this.parent) === JSON.stringify(this.selected.slice(0, -1));
		new Setting(controls).setName('Final position').setDesc('Choose the final numbered slot under the destination parent.').addDropdown((dropdown) => {
			dropdown.selectEl.dataset.field = 'position';
			group.forEach((node, index) => { dropdown.addOption(String(index), `${index + 1} · ${sameParent ? node.name : 'Before ' + node.name}`); });
			if (!sameParent) dropdown.addOption(String(group.length), `${group.length + 1} · At end`);
			dropdown.setValue(String(this.position)).setDisabled(!choices.length || this.pending || this.complete).onChange((value) => { this.position = Number(value); });
		});
		const actions = el.createDiv('ssm-actions');
		this.button(actions, 'preview', this.moves ? 'Add move (Pro)' : 'Preview move', !choices.length || (this.moves > 0 && !isPro()), () => this.stage());
		this.button(actions, 'reset', 'Reset preview', false, () => {
			this.preview.after = readTree(writeTree(this.preview.before));
			this.preview.proAction = false;
			this.moves = 0;
			this.selected = [0];
			this.position = 0;
			this.parent = [];
			this.status = 'Preview reset. The index has not changed.';
		});
		this.button(actions, 'apply', 'Back up and apply', sameOrder(this.preview.before, this.preview.after), async () => {
			const result = await this.plugin.applyPreview(this.preview);
			this.status = result.changed ? `Order applied. Backup: ${result.backupPath}` : 'The order is unchanged. No write or backup is needed.';
			this.complete = result.changed;
			new Notice(this.status, 15000);
		}, true);
		const trees = el.createDiv('ssm-trees');
		for (const [label, tree, key] of [['Current order', this.preview.before, 'before'], ['Resulting order', this.preview.after, 'after']] as const) {
			const panel = trees.createDiv('ssm-tree-panel');
			panel.createEl('p', { text: label, cls: 'ssm-tree-title' });
			panel.createEl('pre', { text: treeLines(tree).join('\n') || '(empty scene tree)', attr: { 'data-tree': key } });
		}
		el.createEl('p', { text: this.status, cls: 'ssm-status', attr: { role: 'status', 'data-pending': String(this.pending) } });
		el.createEl('p', { text: 'The backup contains the full source. YAML comments and spacing can change. Keep the backup after a sync.', cls: 'ssm-hint' });
		const details = el.createEl('details', { cls: 'ssm-pro' });
		details.open = this.proOpen;
		details.addEventListener('toggle', () => { this.proOpen = details.open; });
		details.createEl('summary', { text: isPro() ? 'Named manuscript orders · Pro is on' : 'Named manuscript orders (Pro)' });
		const saved = this.plugin.settings.orders.filter((order) => order.indexPath === this.preview.path);
		new Setting(details).setName('Order name').setDesc('Save the resulting order in local plugin data. A matching name replaces its saved order.').addText((text) => {
			text.inputEl.dataset.field = 'order-name';
			text.setPlaceholder('Alternative ending').setValue(this.orderName).setDisabled(this.pending || this.complete || !isPro()).onChange((value) => { this.orderName = value; });
		});
		this.button(details, 'save', 'Save named order (Pro)', !isPro(), async () => {
			await this.plugin.saveOrder(this.orderName, this.preview);
			this.savedName = this.orderName.trim();
			this.status = `Saved order: ${this.savedName}. The index has not changed.`;
		});
		new Setting(details).setName('Saved order').addDropdown((dropdown) => {
			dropdown.selectEl.dataset.field = 'saved-order';
			dropdown.addOption('', 'Select a saved order');
			for (const order of saved) dropdown.addOption(order.name, order.name);
			dropdown.setValue(this.savedName).setDisabled(this.pending || this.complete || !isPro()).onChange((value) => { this.savedName = value; });
		});
		this.button(details, 'restore', 'Preview saved order (Pro)', !isPro() || !saved.length, () => {
			const order = saved.find((item) => item.name === this.savedName);
			if (!order) throw new Error('Select a saved order.');
			this.preview.after = this.plugin.restoreOrder(order, this.preview);
			this.preview.proAction = true;
			this.moves = 1;
			this.selected = [0];
			this.position = 0;
			this.parent = [];
			this.status = `Saved order preview: ${order.name}. Scenes and parent relationships match. Apply makes a backup first.`;
		});
	}
}
