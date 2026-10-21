/** Bases DOM classes are not API. Keep the selectors here and check them in the real app. */
export const DOM = {
	view: '.bases-view',
	row: '.bases-tr',
	search: '.bases-toolbar-search',
	embed: '.internal-embed.bases-embed[src], .internal-embed[src*=".base"]',
	region: '.bases-view, .bases-header, .bases-toolbar, .bases-tbody, .bases-thead, .bases-toolbar-menu',
	cell: '.bases-td, .bases-table-cell, .bases-cards-property, .bases-list-property, .bases-kanban-card-property, .metadata-property, .bases-property',
	drag: '.bases-card, .bases-cards-item, .bases-list-item, .bases-kanban-card, .bases-th, .bases-table-header, [draggable="true"]',
	link: '.internal-link, .metadata-link, a.external-link',
	switch: '.bases-view-switcher, .bases-toolbar-item.bases-toolbar-views-menu, .bases-view-selector',
	toolbar: '.bases-toolbar-item, .bases-kanban-column-create, .bases-kanban-column-footer',
	column: '.bases-thead, .bases-kanban-column-header',
	hidden: '.bases-toolbar-item:not(.bases-toolbar-views-menu, .bases-toolbar-search), .bases-kanban-column-create, .bases-kanban-column-footer',
	header: '.bases-th',
	popup: '.bases-toolbar-menu',
	viewChoice: '[data-group="views"] .bases-toolbar-menu-item',
	popupAction: '.clickable-icon, .bases-toolbar-menu-action-icon',
	popupGrip: '.bases-toolbar-menu-item-info-icon',
	popupSearch: '.search-input-container input',
	popupClose: '.close-icon, .back-button, .modal-header-button',
	selected: '.bases-toolbar-menu-item.is-selected, .suggestion-item.is-selected',
	stepper: 'input[type="number"], input[type="date"], input[type="datetime-local"], input[type="time"], input[type="month"], input[type="week"]',
	propertyAttrs: ['data-property', 'data-property-id', 'data-column', 'data-column-id'],
} as const;
export const PATH_ATTR = 'data-brl-path';
export const LOCK_CLASS = 'brl-locked';
