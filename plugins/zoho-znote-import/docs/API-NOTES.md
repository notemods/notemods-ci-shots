# Public API checks

The builder read these declarations in the installed Obsidian 1.14.4 obsidian.d.ts before use. The API gate selects 1.13.4 as the earliest public app release for this plugin.

| API | Signature checked |
| --- | --- |
| Plugin.addCommand | addCommand(command: Command): Command |
| Plugin.addSettingTab | addSettingTab(settingTab: PluginSettingTab): void |
| Plugin.loadData | loadData(): Promise<any> |
| Plugin.saveData | saveData(data: any): Promise<void> |
| Component.register | register(cb: () => any): void |
| Component.registerInterval | registerInterval(id: number): number |
| Workspace.onLayoutReady | onLayoutReady(callback: () => any): void |
| Modal | constructor(app: App), open(), onOpen(), onClose(), setTitle() |
| Setting | constructor(containerEl: HTMLElement), setName(), setDesc(), setHeading(), addText(), addTextArea(), addDropdown(), addButton() |
| Text and dropdown controls | setValue(), setDisabled(), onChange(); DropdownComponent.addOption() |
| ButtonComponent | setButtonText(), setDisabled(), setCta(), onClick() |
| Notice | constructor(message: string or DocumentFragment, duration?: number) |
| Vault.getAbstractFileByPath | getAbstractFileByPath(path: string): TAbstractFile or null |
| Vault.createFolder | createFolder(path: string): Promise<TFolder> |
| Vault.create | create(path: string, data: string, options?: DataWriteOptions): Promise<TFile> |
| Vault.createBinary | createBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<TFile> |
| Vault.read | read(file: TFile): Promise<string> |
| DataWriteOptions | ctime?: number; mtime?: number, in milliseconds |
| normalizePath | normalizePath(path: string): string |
| stringifyYaml | stringifyYaml(obj: any): string |
| htmlToMarkdown | htmlToMarkdown(html: string or HTMLElement or Document or DocumentFragment): string |
| PluginSettingTab | constructor(app: App, plugin: Plugin), getSettingDefinitions() |
| SettingTab.update | update(): void |
| DOM helpers | empty(), createEl(), createDiv(), addClass() |

The GitHub Sponsors adapter is the unchanged shared license package. Source files import its typed public factory and setting definitions. Runtime import code uses browser APIs. Test code uses Node to read local fixtures. No obsidian-typings package is used.
