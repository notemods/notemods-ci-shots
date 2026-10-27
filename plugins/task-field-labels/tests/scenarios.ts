import { vi } from 'vitest';
import { FieldAdapter } from '../src/adapter';
import { displayFor, normalizeSettings } from '../src/options';

export interface Scenario { field: string; text: string; mode?: string; ordinary?: boolean; nested?: boolean; custom?: string; pro?: boolean; compact?: boolean; rules?: string; path?: string }
export function makeRow(s: Scenario) {
	const row = document.createElement('li'); row.className = s.ordinary ? 'task-list-item' : 'task-list-item plugin-tasks-list-item';
	const check = document.createElement('input'); check.type = 'checkbox'; row.append(check);
	const link = document.createElement('a'); link.href = '#'; link.textContent = 'Project'; row.append(link);
	const outer = document.createElement('span'); outer.className = 'task-' + s.field;
	const inner = document.createElement('span');
	if (s.nested) { const b = document.createElement('b'); b.textContent = s.text; inner.append(b); } else inner.textContent = s.text;
	outer.append(inner); row.append(outer);
	return { row, outer, inner, check, link };
}
export async function runScenario(s: Scenario): Promise<unknown> {
	const root = document.createElement('div'); document.body.append(root);
	const r = makeRow(s); let clicks=0, menus=0, checks=0, links=0;
	r.outer.addEventListener('click', () => clicks++); r.outer.addEventListener('contextmenu', () => menus++);
	r.check.addEventListener('click', () => checks++); r.link.addEventListener('click', (e) => { e.preventDefault(); links++; });
	let settings = normalizeSettings({ labels: { [s.field]: s.custom }, compact: s.compact, folderRules: s.rules });
	const adapter = new FieldAdapter(root, () => displayFor(settings, s.pro ?? false, s.path ?? 'Plan.md'));
	if (s.mode !== 'async') root.append(r.row);
	adapter.refresh();
	try {
		if (s.mode === 'async') {
			for(let i=0;i<3;i++) root.append(makeRow(s).row);
			await vi.waitFor(() => { if (adapter.count !== 3) throw new Error('Rows not labeled'); });
			return Array.from(root.querySelectorAll('.task-due')).map((e) => e.textContent);
		}
		if (s.mode === 'repeat') for(let i=0;i<10;i++) adapter.scan();
		if (s.mode === 'events') {
			r.inner.dispatchEvent(new MouseEvent('click', { bubbles:true })); r.inner.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true })); r.check.click(); r.link.click();
			return { text:r.inner.textContent, clicks, menus, checks, links };
		}
		if (s.mode === 'disable') {
			root.append(makeRow(s).row); adapter.scan(); settings.enabled=false; adapter.refresh(); r.outer.click();
			return { texts:Array.from(root.querySelectorAll('.task-due')).map((e) => e.textContent), observing:adapter.observing, clicks };
		}
		if (s.mode === 'checkbox') {
			r.check.addEventListener('click', () => { r.row.replaceWith(makeRow(s).row); }); r.check.click();
			await vi.waitFor(() => { if(root.querySelector('.task-recurring')?.textContent !== 'Repeat: every week') throw new Error('Refresh pending'); });
			return { text:root.querySelector('.task-recurring')?.textContent, checks };
		}
		if (s.mode === 'external') { r.inner.firstChild!.textContent='Other plugin text'; adapter.dispose(); }
		if (s.mode === 'compact') return r.outer.classList.contains('task-field-labels-compact');
		return r.inner.textContent;
	} finally { adapter.dispose(); root.remove(); }
}
