import type { Layout, PropertyRow } from './header';

/** Render with DOM text nodes so property text cannot inject HTML or load remote resources. */
export function renderHeader(container: HTMLElement, rows: PropertyRow[], layout: Layout, preview: boolean): HTMLElement {
	const header = container.createEl('section');
	header.className = `ppe-header ppe-${layout}${preview ? ' ppe-preview' : ''}`;
	header.setAttribute('aria-label', 'Note properties');
	const title = header.createDiv();
	title.className = 'ppe-title';
	title.textContent = 'Properties';
	header.append(title);
	const list = header.createEl('dl');
	for (const row of rows) {
		const pair = list.createDiv();
		const key = pair.createEl('dt');
		key.textContent = row.key;
		const value = pair.createEl('dd');
		value.textContent = row.value;
		pair.append(key, value);
		list.append(pair);
	}
	header.append(list);
	return header;
}
