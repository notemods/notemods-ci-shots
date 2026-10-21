# Bases Multi Group

Bases Multi Group adds a table view to Obsidian Bases. Group tasks by status, then project, and fold the sections you have finished reading. Each header shows how many notes belong to that group. A note with several list values can appear under each value when you turn on list splitting.

## Features

### Two nested grouping properties

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-group/HEAD/docs/nested-groups.png" alt="Tasks grouped by status and project, with note counts at each level" width="720">

Two grouping levels, list splitting, fold controls and counts are free. Pro adds a third level, sum or average of a number property, and saved folds per base view. Pro costs $15 one time or $5 a month through [GitHub Sponsors](https://github.com/sponsors/theluckystrike?metadata_source=bases-multi-group). Choose the [$15 one-time offer](https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-multi-group), then sign in from the plugin settings.

Choose First property and Then property in the view options. For example, a Doing group contains an Atlas group and a Beacon group. Groups sort by label, with numbers in natural order. Notes within a group keep the base's sort order.

The table uses the visible properties of the base and always puts a note link first. Click the name to open that note. Hold Ctrl or Cmd while clicking to open it in another tab. Edit properties in a note or a core table view.

### Fold groups and read counts

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-group/HEAD/docs/collapsed-groups.png" alt="Top-level groups folded with their note counts still visible" width="720">

Click a header to fold or unfold it. Collapse all folds every level. Expand all opens every level. Tab reaches a header; Enter or Space toggles it. Folding a parent keeps its children's fold choices for the current view session. Counts show unique notes in that group, including notes hidden by a fold.

A parent count can be smaller than the sum of its child counts when a list puts the same note in several children. The parent still counts that note once. Folding changes what you see, without changing the base filters or the notes.

### Optional list splitting

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-group/HEAD/docs/list-groups.png" alt="A writing task appearing under both Planning and Writing" width="720">

Turn on Put list items in separate groups to show a note in every group its list names. A task with work values Planning and Writing appears under both headings. Repeated items within one list do not add duplicate rows to a group. With splitting off, the whole list is one combined group value, including item order.

Values use exact matching. Todo and todo stay separate. A numeric 1 and a text value 1 also stay separate, even though their labels look the same. Empty values, missing properties and empty lists go into a group labeled (no value). Zero and false are real values and get their own groups. Formula results and file properties can also be selected.

### Third level and number summaries (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-group/HEAD/docs/pro-summary.png" alt="Example Pro view with status, project and owner groups and summed hours" width="720">

Choose Third property to add another level. Pick a number property and choose Sum or Average to show a summary on every header. Each group counts its notes once for the summary, including parents whose children share a note. Only finite number values contribute. Text that looks like a number, lists and checkboxes do not contribute. A group without any numbers says no numbers. Displayed results round to two decimal places.

Turn on Remember collapsed groups to save folds in that base view. Each view has its own saved choices. The example screenshot uses a test sponsorship response to show Pro features, without a live purchase. 

<img src="https://raw.githubusercontent.com/theluckystrike/bases-multi-group/HEAD/docs/grouping.gif" alt="Expanding and collapsing nested project groups" width="720">

## Install

Requires Obsidian 1.13.4 or newer and the Bases core plugin. When this product is listed in the community directory, open Settings, Community plugins, Browse, then search for Bases Multi Group. Install and enable it.

For a manual installation, copy main.js, manifest.json and styles.css from a release into your vault's .obsidian/plugins/bases-multi-group folder. Reload the community plugin list and enable Bases Multi Group. Add a new view of type Multi group to an existing base.

## Usage

1. Open a base with the notes you want to review.
2. Add a Multi group view from the view menu.
3. Open the view options and choose First property, such as status.
4. Choose Then property, such as project.
5. Select visible columns and note sorting using the base toolbar.
6. Fold a header, or use Collapse all and Expand all.

The view uses the results of the base query, including its filters, sorting and limit. It has its own grouping options; the core Group by menu does not choose these levels. With no grouping property selected, it shows a plain table and a setup hint. If no notes match, it shows an empty-state message.

## Settings

Grouping choices live in each base view, so different bases can use different hierarchies. First property, Then property and Put list items in separate groups are free options. Third property, Number property for summary, Summary and Remember collapsed groups apply when Pro is on. Splitting and saved folds are off by default. The default summary mode is Sum.

The plugin settings contain the Pro offer, GitHub sign-in, refresh and sign-out controls. There is no startup payment prompt. When Pro is off, the view still shows two levels with fold controls and counts. A saved third level and summary are ignored until Pro is available again. The notes remain ordinary Markdown files.

## FAQ

### How does this compare with Split Groups?

[Split Groups](https://github.com/lagudafuadtosin/split-groups) already offers two nested properties, folds, counts and saved folds, along with table, list, cards and kanban layouts. Bases Multi Group focuses on a table with optional list splitting and exact value matching. Its Pro features add a third level and number summaries. Choose the view whose behavior fits your data; two-level nesting is shared functionality.

### Does core Bases already fold groups?

Yes. Obsidian 1.14 added fold controls to core layouts. This view adds an ordered hierarchy of grouping properties. Its grouping choices are separate from the core Group menu.

### Where are folds saved?

Free folds last for the current view session. With Pro and Remember collapsed groups on, the base view configuration stores typed group paths. Changing grouping properties gives different paths. Renaming a group value gives it a new path and it starts expanded.

### What happens when I disable the plugin?

Custom views need this plugin to render. Switch to a core Table view to read the same notes. The plugin does not rewrite note properties. Its view options remain in the base file.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Bases Multi Group makes no network requests. Sign in uses the GitHub device flow. Bases Multi Group sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Bases Multi Group sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Visit [NoteMods](https://notemods.com/) for the product collection. Report problems in this repository's issue tracker with your Obsidian version, grouping properties and a small base example that contains no private notes.

To build from source, run npm ci, npm run build, npm run lint and npm test. Unit tests cover grouping values, duplicate lists, nesting, counts and summaries. Real-app tests cover folding, list splitting and saved Pro folds. MIT license.
