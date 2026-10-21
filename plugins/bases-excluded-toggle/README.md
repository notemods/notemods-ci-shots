# Excluded Files Toggle

Show notes from excluded folders in a Base, search or graph, then restore your vault's Excluded files patterns with one more click.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-excluded-toggle/HEAD/docs/excluded-files-toggle.png" alt="A Bases table with a note from an excluded folder visible" width="720">

The free version toggles every pattern in Obsidian's native Excluded files list. Pro adds named exclusion presets. The price is $15 one time or $5 a month. [Sponsor monthly or choose another amount](https://github.com/sponsors/theluckystrike?metadata_source=bases-excluded-toggle) or choose [$15 one time](https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-excluded-toggle).

## Features

### Toggle the native Excluded files list

Excluded Files Toggle uses the patterns already in Settings, Files and links, Excluded files. It does not ask you to keep a second list or retype your paths. Use its command or ribbon button to clear the patterns for a short period. Use the same command again to restore them.

For example, you may exclude `Archive/` so old notes stay out of link suggestions and search results. Open a Base that lists archive notes and run “Toggle excluded files visibility”. The archived notes can then appear in that Base, Search and Graph. Run the command again when you finish. Your original pattern returns.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-excluded-toggle/HEAD/docs/excluded-files-toggle.png" alt="A Bases table showing a note from the Archive folder" width="720">

The plugin toggles the vault-wide Excluded files setting. This matches Obsidian's setting scope. The command cannot change exclusions for only one Base while leaving Search and Graph unchanged. Keep this scope in mind if you have a search open or another person is using a synced vault at the same time.

If you add a pattern while visibility is on, the plugin merges it with the saved patterns when you restore them. It keeps the first occurrence of each exact string. It preserves the order of the saved patterns and then appends new patterns. This avoids losing an edit made in Obsidian settings during the temporary state.

On plugin unload, it restores a saved list. If Obsidian changes or removes the private setting methods that this feature needs, the plugin shows an error and leaves the current setting unchanged. A later Obsidian update may require a plugin update before the toggle works again.

The animated example shows the temporary state and the restored state in one Base.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-excluded-toggle/HEAD/docs/excluded-files-toggle.gif" alt="Toggle an excluded folder off and on in a Base" width="720">

### Save named presets with Pro

Pro adds named presets for patterns that you use at different times. Save the current patterns with a name such as “Archive” or “Templates”. Apply a preset from the plugin settings when you need that set. Applying a preset replaces the active native list and clears any temporary visibility state.

Presets store exact pattern strings in this vault's plugin data. They do not create settings outside the vault, edit notes or send the patterns to a server. The free version includes the complete toggle job and does not require an account.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-excluded-toggle/HEAD/docs/pro-presets.png" alt="Sample Pro settings with saved exclusion presets" width="720">

## Install

When Excluded Files Toggle is listed in the Obsidian community directory, open Settings, then Community plugins, then Browse. Search for “Excluded Files Toggle”, select Install, and then select Enable.

To install by hand, download `main.js` and `manifest.json` from a release. Create the folder `<vault>/.obsidian/plugins/bases-excluded-toggle/` if it does not exist. Put the files in that folder. Reload the list of community plugins and enable Excluded Files Toggle. Keep the plugin folder name as `bases-excluded-toggle` so Obsidian can find the plugin data.

The plugin supports Obsidian 1.13.4 and later. Its manifest sets the minimum supported app version.

## Usage

First add one or more patterns in Settings, Files and links, Excluded files. Use Obsidian's own syntax for folders, files or regular expressions. The plugin reads these patterns from the native setting.

Select the ribbon eye icon or run “Toggle excluded files visibility” from the command palette. The first toggle saves the patterns to this vault's plugin data and clears the native list. Open Bases tabs reapply their current view state so their queries run again. Search and Graph also refresh after the change.

Select the same command again to restore your saved patterns. The plugin includes entries that were added while the setting was clear. If there were no patterns to begin with, the command explains that there is nothing to show. It makes no change in that case.

You can assign a hotkey to the command in Settings, Hotkeys. The command is available from any workspace view because it changes one vault-wide setting. You can run it while a Base is open or before you open Search or Graph.

To use Pro presets, save a preset from the plugin settings while signed in with a GitHub account that sponsors the project. Apply a saved preset from that same settings tab. A preset replaces the active patterns. Apply it after completing the temporary show operation if you want a different exclusion list.

## Settings

The Excluded files row shows whether the plugin has a saved pattern list for restore. Its button toggles the same state as the command and ribbon icon. This can help if the ribbon is hidden or you prefer to manage the feature from settings.

Pro users can enter a name and save a preset. Each saved preset shows the number of patterns it contains. Apply a preset to make those patterns active. Use its delete button to remove a preset. Deleting a preset does not change the patterns that are active in Obsidian.

The plugin uses GitHub Sponsors to show the Pro offer and sign in. It stores the access token in Obsidian SecretStorage when available. If SecretStorage is not available, the sign-in token stays in memory and you need to sign in again after a restart.

## FAQ

### Does this change my files?

No. The plugin changes only the native Excluded files setting and its own local plugin data. It does not rename, move, read or edit note contents.

### Will it work only in Bases?

No. Obsidian has one Excluded files list for the vault. Clearing it can make files available to Bases, Search, Graph, link suggestions and other views that use this setting. The plugin does not provide a separate Bases-only filter.

### Why does the plugin use a private API?

The public plugin API does not expose the Excluded files list for reading or writing. The plugin checks for the required methods before each operation. Obsidian may change this API without notice. If the API is unavailable, the plugin reports the issue and leaves the setting unchanged.

### Does the plugin make requests when I install it?

No. The GitHub Sponsors check makes no request until you choose Sign in with GitHub. The plugin does not send vault content or exclusion patterns to GitHub.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Excluded Files Toggle makes no network requests. Sign in uses the GitHub device flow. Excluded Files Toggle sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Excluded Files Toggle sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

For support, feature requests or bug reports, visit [NoteMods](https://notemods.com/). Include your Obsidian version and the plugin version. Do not include private notes or tokens.

To build from source, use Node.js 24 and pnpm 10 from the factory repository:

```sh
pnpm install --frozen-lockfile
pnpm --filter bases-excluded-toggle build
pnpm --filter bases-excluded-toggle test
```

## License

The source code is available under the MIT license.
