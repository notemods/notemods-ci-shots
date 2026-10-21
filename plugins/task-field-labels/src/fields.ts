export const LABELS = {
	due: 'Due', start: 'Start', scheduled: 'Scheduled', created: 'Created', done: 'Done', cancelled: 'Cancelled', priority: 'Priority', recurring: 'Repeat',
};
export type Field = keyof typeof LABELS;
export type Labels = Record<Field, string>;
export const FIELDS = Object.keys(LABELS) as Field[];
const ICONS: Record<string, string> = { '🔺': 'Highest', '⏫': 'High', '🔼': 'Medium', '🔽': 'Low', '⏬': 'Lowest' };
const DATES: Record<string, string> = { due: '📅', start: '🛫', scheduled: '⏳', created: '➕', done: '✅', cancelled: '❌' };

/** A label is plain text. Empty or long values use the fixed English label. */
export function cleanLabel(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 40 ? value.trim().replace(/\s+/g, ' ') : fallback;
}

/** Only full fields from the tested Tasks emoji format are accepted. Short mode is left alone. */
export function fieldLabel(field: string, text: string, labels: Labels = LABELS): string | null {
	if (!FIELDS.includes(field as Field)) return null;
	const key = field as Field;
	const trimmed = text.trim();
	let value: string;
	if (key === 'priority') {
		value = ICONS[trimmed] ?? '';
		if (!value) return null;
	} else if (key === 'recurring') {
		if (!trimmed.startsWith('🔁 ')) return null;
		value = trimmed.slice('🔁 '.length).trim();
		if (!value) return null;
	} else {
		const icon = DATES[key];
		if (!icon) return null;
		if (!trimmed.startsWith(icon + ' ')) return null;
		value = trimmed.slice(icon.length).trim();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	}
	const lead = text.slice(0, text.length - text.trimStart().length);
	const trail = text.slice(text.trimEnd().length);
	return lead + cleanLabel(labels[key], LABELS[key]) + ': ' + value + trail;
}
