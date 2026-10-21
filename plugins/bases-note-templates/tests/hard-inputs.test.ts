import { describe, expect, it } from 'vitest';
import { newButtonProps, planNewNote, type Props, type VarContext } from '../src/template';
import { filtersToProperties } from '../src/filters';

const ctx: VarContext = { title: '日本語 Café 🧪', now: new Date('2026-10-18T09:00:00'), dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm', base: '研究', view: 'Notes', template: '会議 🧪', props: {} };

describe('nested template properties', () => {
	it('renders arrays and nested mappings for both creation paths without changing the template', () => {
		const props = { aliases: ['{{title}} 別名'], meta: { title: '{{title}}', entries: ['{{base}}', { template: '{{template}}' }], count: 2, enabled: false, blank: null } } as unknown as Props;
		const before = JSON.stringify(props);
		const expected = { aliases: ['日本語 Café 🧪 別名'], meta: { title: '日本語 Café 🧪', entries: ['研究', { template: '会議 🧪' }], count: 2, enabled: false, blank: null } };
		expect(newButtonProps({}, props, {}, ctx)).toEqual(expected);
		const plan = planNewNote({ now: '2026-10-18T09:00:00', pattern: '日本語 Café 🧪', base: '研究', templateName: '会議 🧪' }, props);
		expect(plan.properties).toEqual(expected);
		expect(JSON.stringify(props)).toBe(before);
	});

	it('keeps Unicode filter property names', () => {
		expect(filtersToProperties({ and: ['note.状態 == "進行中"', '担当者 == "Zoë"'] }, undefined).properties).toEqual({ 状態: '進行中', 担当者: 'Zoë' });
	});

	it('keeps a valid YAML block with a byte order mark or a YAML end marker out of the body', () => {
		const plan = planNewNote({ now: '2026-10-18T09:00:00', template: '\uFEFF---\nname: X\n...\n# {{title}}', pattern: '日本語' }, { name: 'X' });
		expect(plan.body).toBe('# 日本語');
	});
});
