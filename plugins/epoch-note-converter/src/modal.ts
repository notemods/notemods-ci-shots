import { Modal, Notice, Setting, type Editor } from 'obsidian';
import { column, convert, ISO_FORMAT, type Result, type Unit } from './converter';
import { applyEdit, type Snapshot } from './edit';
import { PRO_UI, isPro, onProChange } from './pro';
import type EpochNoteConverterPlugin from './main';

export class ConverterModal extends Modal {
	private choice: { unit: Unit; zone: string } | null = null;
	private savedFormat = false;
	private unsubscribe: (() => void) | null = null;
	private applied = false;

	constructor(readonly owner: EpochNoteConverterPlugin, readonly editor: Editor, readonly saved: Snapshot, readonly batch: boolean) {
		super(owner.app);
		this.shouldRestoreSelection = false;
	}
	onOpen(): void {
		this.modalEl.addClass('epoch-converter-modal');
		this.setTitle(this.batch ? PRO_UI.columnCommand : 'Convert selected timestamp');
		this.unsubscribe = onProChange(() => {
			this.choice = null;
			this.savedFormat = false;
			this.render();
		});
		this.render();
	}

	private result(unit: Unit, zone: string): Result {
		return (this.batch ? column : convert)(this.saved.text, unit, zone, this.savedFormat ? this.owner.settings.format : ISO_FORMAT);
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		el.createEl('p', { text: this.batch ? 'One integer per row, up to 500 rows. Choose a unit and a time zone.' : 'Choose seconds or milliseconds. The converter does not guess the unit.' });
		el.createEl('pre', { text: this.saved.text.split('\n').slice(0, 5).join('\n'), cls: 'epoch-source' });
		if (isPro()) new Setting(el).setName('Output format').addDropdown((d) => d.addOption('iso', PRO_UI.standardFormat).addOption('saved', PRO_UI.formatChoice).setValue(this.savedFormat ? 'saved' : 'iso').onChange((value) => { this.savedFormat = value === 'saved'; this.render(); }));
		for (const unit of ['seconds', 'milliseconds'] as const) {
			new Setting(el).setName(unit === 'seconds' ? 'Seconds interpretation' : 'Milliseconds interpretation').setHeading();
			this.addChoice(el, unit, 'utc', 'UTC');
			this.addChoice(el, unit, 'local', 'Device local');
		}
		if (isPro() && this.owner.settings.zones) {
			new Setting(el).setName(PRO_UI.zoneHeading).setHeading();
			for (const zone of this.owner.settings.zones.split(', ')) {
				for (const unit of ['seconds', 'milliseconds'] as const) this.addChoice(el, unit, zone, `${zone} · ${unit}`);
			}
		}
		const selected = this.choice ? this.result(this.choice.unit, this.choice.zone) : null;
		el.createEl('p', { text: this.choice ? `Chosen: ${this.choice.unit} · ${this.choice.zone}` : 'No result chosen. Select a labeled result above.', cls: 'epoch-chosen' });
		const actions = new Setting(el).setClass('epoch-actions').setName('Apply chosen result');
		actions.addButton((b) => b.setButtonText('Insert beside original').setDisabled(!selected?.ok).onClick(() => this.apply('insert')));
		actions.addButton((b) => b.setButtonText('Replace selection').setDisabled(!selected?.ok).onClick(() => this.apply('replace')));
		actions.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
	}

	private addChoice(el: HTMLElement, unit: Unit, zone: string, label: string): void {
		const result = this.result(unit, zone);
		const row = new Setting(el).setClass('epoch-result').setName(label);
		row.settingEl.setAttr('data-unit', unit);
		row.settingEl.setAttr('data-zone', zone);
		row.setDesc(result.ok ? result.value.split('\n').slice(0, 3).join('\n') + (this.batch && this.saved.text.split('\n').length > 3 ? '\n…' : '') : result.error);
		if (!result.ok) row.settingEl.addClass('epoch-error');
		row.addButton((b) => b.setButtonText(this.choice?.unit === unit && this.choice.zone === zone ? 'Chosen' : 'Choose').setDisabled(!result.ok).onClick(() => { this.choice = { unit, zone }; this.render(); }));
	}

	private apply(mode: 'insert' | 'replace'): void {
		if (this.applied || !this.choice) return;
		if ((this.batch || this.savedFormat || !['utc', 'local'].includes(this.choice.zone)) && !isPro()) {
			new Notice('Pro is off. Run a fresh command to choose a free result.');
			return;
		}
		const result = this.result(this.choice.unit, this.choice.zone);
		if (!result.ok) { new Notice(result.error); return; }
		if (!applyEdit(this.editor, this.saved, result.value, mode)) {
			new Notice('The source or selection changed. Run the command again for a fresh preview.');
			this.close();
			return;
		}
		this.applied = true;
		this.close();
		this.editor.focus();
	}

	onClose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.owner.previews.delete(this);
		this.contentEl.empty();
	}
}
