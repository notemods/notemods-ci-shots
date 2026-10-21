import type { App } from 'obsidian';

interface SearchComponentInternal {
	getValue?: () => string;
}

interface SearchViewInternal {
	searchComponent?: SearchComponentInternal;
	setQuery?: (query: string) => void;
	onSearch?: () => void;
}

interface GraphEngineInternal {
	update?: () => Promise<void> | void;
	render?: () => void;
}

interface GraphViewInternal {
	dataEngine?: GraphEngineInternal;
}

function isSearchView(value: unknown): value is SearchViewInternal {
	return typeof value === 'object' && value !== null;
}

function isGraphView(value: unknown): value is GraphViewInternal {
	return typeof value === 'object' && value !== null;
}

export async function refreshAffectedViews(app: App): Promise<void> {
	for (const leaf of app.workspace.getLeavesOfType('bases')) {
		const state = leaf.getViewState();
		await leaf.setViewState(state);
	}
	for (const leaf of app.workspace.getLeavesOfType('search')) {
		const view: unknown = leaf.view;
		if (!isSearchView(view)) continue;
		const query = view.searchComponent?.getValue?.();
		if (typeof query !== 'string') continue;
		view.setQuery?.(query);
		view.onSearch?.();
	}
	for (const type of ['graph', 'localgraph']) {
		for (const leaf of app.workspace.getLeavesOfType(type)) {
			const view: unknown = leaf.view;
			if (!isGraphView(view)) continue;
			await view.dataEngine?.update?.();
			view.dataEngine?.render?.();
		}
	}
}
