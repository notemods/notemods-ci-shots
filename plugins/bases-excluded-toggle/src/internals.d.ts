import 'obsidian';

declare module 'obsidian' {
	interface Vault {
		getConfig?(key: 'userIgnoreFilters'): unknown;
		setConfig?(key: 'userIgnoreFilters', value: string[]): void;
	}
}
