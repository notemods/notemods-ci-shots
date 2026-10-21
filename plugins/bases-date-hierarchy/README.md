# Bases Date Hierarchy

Bases Date Hierarchy gives Obsidian Bases a date view with nested Year > Month > Day groups. Choose one date property and read a timeline of your notes. Fold a year, open a month and see the days inside it. Every header shows a note count. Months follow the calendar, so February comes before April when you choose oldest first.

## Features

### Nested calendar levels

<img src="https://raw.githubusercontent.com/theluckystrike/bases-date-hierarchy/HEAD/docs/calendar-levels.png" alt="Tasks nested under year, month and day headings with counts" width="720">

Year > Month > Day, collapse and expand, counts, and newest or oldest first are free. ISO weeks with real start and end dates are also free. Pro adds sums or averages and saved folds. Pro costs $15 one time or $5 a month through [GitHub Sponsors](https://github.com/sponsors/theluckystrike?metadata_source=bases-date-hierarchy). Use the [$15 one-time offer](https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-date-hierarchy), then sign in from the plugin settings.

Choose Date property in the view options. It can be a note date property, a file date such as creation time, or a formula that returns a date. The view makes three levels from that one value. Notes inside a day keep the sorting you set in the base toolbar. Visible columns come from that toolbar too, with a note link first. Select a note name to open it; Ctrl or Cmd opens another tab.

### Fold any date level

<img src="https://raw.githubusercontent.com/theluckystrike/bases-date-hierarchy/HEAD/docs/collapsed-groups.png" alt="Years collapsed while their note counts remain visible" width="720">

Click a header to fold it. Tab reaches each header; Enter or Space toggles it. Collapse all folds the top groups with one saved key per year. Expand all opens every level again. Counts include notes hidden by folds and count each note once in a group. Each month has one table, so columns stay aligned across its days. Updates preserve scroll and keyboard focus. Note links support hover preview and middle-click to open a tab. Folding a parent keeps its children's choices for the current view session. Changing a filter updates the counts to match the query results.

### Chronological order and undated rows

<img src="https://raw.githubusercontent.com/theluckystrike/bases-date-hierarchy/HEAD/docs/oldest-first.png" alt="The oldest year shown first and a final No date group" width="720">

Newest first is on by default. Turn it off to read years, months and days from oldest to newest. Ordering uses calendar values, independently of the text shown on a header. Missing values and invalid dates share one No date group at the end in either direction. Those notes stay visible so you can open them and fix the date. Impossible dates such as February 30 are rejected. Numbers, checkboxes and lists are not dates.

### Free ISO weeks and Pro summaries

<img src="https://raw.githubusercontent.com/theluckystrike/bases-date-hierarchy/HEAD/docs/iso-weeks.png" alt="Example Pro week groups with Monday to Sunday ranges and summed hours" width="720">

Choose ISO week as the middle level for Year > ISO week > Day. Weeks start on Monday and end on Sunday. Each heading gives the real start and end dates, including when they cross a month or year. The top year is the ISO week year: December 31, 2025 belongs to week 1 of 2026. This keeps the whole week together. Locale-specific Sunday weeks are not offered.

Select a number property and Sum or Average to add a result to each header. Only finite numbers contribute; numeric text does not. A group without numbers says no numbers. Results display to two decimal places at most. Remember collapsed groups saves folds in that base view. The screenshot uses a test sponsorship response to demonstrate Pro, without a live purchase.

### Expand the timeline

<img src="https://raw.githubusercontent.com/theluckystrike/bases-date-hierarchy/HEAD/docs/grouping.gif" alt="Collapsing and expanding the date hierarchy" width="720">

Use the two buttons above the groups to scan a long timeline, then open the period you need. These controls do not change your note properties or the base filters.

## Install

Requires Obsidian 1.13.4 or newer with the Bases core plugin enabled. When this product is listed, open Settings, Community plugins, Browse, and search for Bases Date Hierarchy. Install and enable it.

For manual installation, copy main.js, manifest.json and styles.css from a release into your vault's .obsidian/plugins/bases-date-hierarchy folder. Reload the community plugin list and enable the plugin.

## Usage

1. Open a base and add a view of type Date hierarchy.
2. Open the view options and select Date property.
3. Choose newest first or oldest first.
4. Select columns and row sorting in the base toolbar.
5. Open a date heading or use Expand all.

The view uses the base query, filters and limit. Its date option is separate from the core Group menu. With no date property selected, a setup hint appears above a plain table. When the query matches no notes, an empty message appears. Edit dates in notes or a core Table view; this view does not offer inline editing.

## Settings

<img src="https://raw.githubusercontent.com/theluckystrike/bases-date-hierarchy/HEAD/docs/settings.png" alt="Plugin settings with the free core description and optional Pro sign-in" width="720">

Date property, Newest first and Middle level belong to each base view. The default middle level is Month. The default summary is Sum and saved folds are off. ISO weeks work without Pro. If Pro is off, numeric summaries are hidden. The plugin settings contain GitHub sign-in, refresh and sign-out controls and one Pro offer. There is no payment prompt at startup.

## FAQ

### Can core Bases do this with a formula?

Core Bases can group by one formula such as date.format("YYYY-MM"), which gives one flat level sorted as text. Zero-padded year-month text sorts chronologically too. Collapsing Group Table also offers nested groups, collapse and counts, including a date.format("YYYY/MM/DD") formula. It had 2,048 downloads in the October 21, 2026 review snapshot. Choose it for general property grouping. This plugin parses dates directly, including text datetimes with a space or T and file.ctime or file.mtime. Its free tier adds ISO week-year ranges, calendar month names, newest or oldest date order independent of row sort, and a No date group that always stays last. Each month or week uses one aligned table with day sub-headers. Pro adds numeric summaries and saved folds.

### Which day does a timestamp use?

Date values use the calendar day supplied by Bases. ISO text dates use their written day, without conversion to another time zone. Use YYYY-MM-DD for plain dates, or YYYY-MM-DD HH:mm and YYYY-MM-DDTHH:mm for text datetimes. Ambiguous text such as 10/11/2026 is rejected.

### Where are folds saved?

Free folds last for the view session. Pro can save them in the base view configuration. Each property and period mode has its own group paths. Switching modes does not apply a month fold to a week. Disabling the plugin leaves your notes intact; use a core Table view to read them.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Bases Date Hierarchy makes no network requests. Sign in uses the GitHub device flow. Bases Date Hierarchy sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Bases Date Hierarchy sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Visit [NoteMods](https://notemods.com/) for the product collection. Report problems in this repository's issue tracker with your Obsidian version, date property and a small example without private notes. Include the expected week range for a week issue.

To build from source, run npm ci, npm run build, npm run lint and npm test. Tests cover calendar validation, chronological order, ISO week boundaries, counts and summaries. Real-app checks cover updates, links, folding and restored Pro state.

## License

MIT
