# Bases Task Rows

Bases Task Rows adds a "Task rows" view to Bases. It shows each checklist task in the notes that a base selects as its own row. A row has the done box, the task text, the due and scheduled dates, the priority, the tags, the source note and the heading above the task. Tick a box in the view and the plugin writes the change to that line.

The view, the done box, sorting, filtering and up to 200 tasks per view are free. Pro removes the limit and adds groups, due date editing in the row, bulk actions, and the next occurrence of a recurring task. Pro costs $5 a month, or $15 once, through GitHub Sponsors.

## Features

### One row per task

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/task-rows.png" alt="A base with 150 tasks from 30 notes, one row per task, with due date, scheduled date, priority, tags, note and heading" width="720">

The base filters decide which notes count, for example "in the folder Projects" or "has the tag #client". The view then lists the task lines, such as `- [ ]` and `- [x]`, in those notes. A task-like line inside a code block does not count.

Select the task text or the note name to open the note at that line.

### Tick a task from the view

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/bases-task-rows.gif" alt="Ticking two tasks in the Task rows view, and the source note shows the x and the done date" width="720">

Tick the box and the plugin changes `[ ]` to `[x]` in the source line. If the line already has a date, it also adds a done date (`✅ 2026-10-10`, or `[completion:: 2026-10-10]` on a Dataview line), the same way the Tasks plugin does. Untick and the done date goes away, unless the done date setting is Never.

Before it writes, the plugin checks that the line in the note is still exactly the line it read. If it changed, nothing is written. A notice tells you, and the view reads the note again. The other lines of the note do not change, and Windows line ends stay.

### Sort and filter

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/filter.png" alt="The filter box with the word budget, which leaves only the matching tasks" width="720">

The toolbar has a filter box, a Show menu (open, done or all tasks), a Sort menu and a button that reverses the sort. Sort by due date, scheduled date, priority, task text, note name or the order in the notes.

The filter box matches words in the task text, tags, note name and heading. The base file keeps the Show and Sort choices.

### Tasks emoji and Dataview fields

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/dataview-dates.png" alt="Tasks from meeting notes written with Dataview fields, with their due dates and priorities in the columns" width="720">

The plugin reads these parts of a task line:

- Dates in Tasks format: `📅` due, `⏳` scheduled, `🛫` start, `✅` done, `➕` created, `❌` cancelled.
- The same dates as Dataview fields in square or round brackets: `due`, `scheduled`, `start`, `completion`, `created`, `cancelled`.
- Priority: `🔺 ⏫ 🔼 🔽 ⏬`, or `[priority:: high]`.
- Tags, but not `#123` and not tags in code.

Dates can also use ISO date links, such as `📅 [[2026-10-18]]` or `[due:: [[2026-10-18]]]`. A date edit keeps the link brackets. An invalid calendar date or a slash date such as `18/10/2026` does not set a date column. Date text inside a code span stays in the Task column.

The Task column shows the text without these parts. A new date uses the format the line already has. For a line without dates, the setting "Format of new dates" decides.

### Groups by date, note, heading or tag (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/date-groups.png" alt="Open tasks grouped under Overdue, Today, Next 7 days, Later and No date" width="720">

Group by date puts each open task under Overdue, Today, Next 7 days, Later or No date, by its due date, or its scheduled date when it has none. Done tasks go under Done. You can also group by note, heading, or tag. A task with two tags shows under both tags.

### Edit due dates, move to today, complete many (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/bulk-actions.png" alt="Three selected rows, the Complete selected and Move selected to today buttons, and a date picker open in a due cell" width="720">

With Pro you can:

- Select a due date to change it. Press Enter to save, Escape to cancel. An empty date removes the due date.
- Select the calendar button of a row to move the task to today. This changes the due date, or the scheduled date when the task has no due date. A task with no date gets a due date of today.
- Select rows with the boxes on the left, then select "Complete selected" or "Move selected to today". "Complete selected" skips done and cancelled tasks.
- Tick a recurring task (a line with the repeat mark and a rule like "every week") to write the next occurrence, with the next date, on the line below. The other dates move by the same number of days. A rule with "when done" counts from the day you tick the task. Without Pro, a recurring task ticks like any other task.

## Install

In Obsidian, open Settings, then Community plugins, then Browse, and search for "Bases Task Rows". Select Install, then Enable.

The plugin needs Obsidian 1.13.4 or newer with the Bases core plugin on. It was tested on desktop with Obsidian 1.13.4 and 1.14.4.

## Usage

1. Open a folder of notes with tasks and run the command "Create a task base for the current folder". The plugin creates `Tasks.base` in that folder with a Task rows view and opens it.
2. Or open any base, select the view menu, add a view, and choose the layout "Task rows".
3. Change the base filters to choose the notes. Change Show, Sort and the columns in the toolbar or in the view options.

The view updates by itself when a note changes.

## Pro

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/pro-settings.png" alt="The Pro section of the settings after sign in, with the GitHub account and the Pro status" width="720">

To get Pro:

1. Sponsor [theluckystrike on GitHub Sponsors](https://github.com/sponsors/theluckystrike) with $5 a month, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply.
2. In Obsidian, open the settings of Bases Task Rows and select "Sign in with GitHub".
3. The plugin copies a code and opens github.com/login/device. Paste the code there and approve.

If you sponsor after you sign in, select Refresh.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/settings.png" alt="Settings with the Pro section, the done date choice and the format of new dates" width="720">

| Setting | Default | Allowed values |
| --- | --- | --- |
| Done date when you tick a task | Auto | Auto, Always, Never |
| Format of new dates | Tasks emoji | Tasks emoji or Dataview field |

Auto adds a done date only to lines that already have a date. Each view also has options in the view menu of the base: Show, Sort by, reverse sort, Group by (Pro), and the Scheduled, Priority, Tags and Heading columns.

## FAQ

### Does it change my notes?

Only when you tick a box or use a Pro action. Then it changes only the box and the done date, or one date, in that one line. With Pro, a tick on a recurring task also adds one new line below it.

### Which statuses count as done?

`x`, `X` and `-` (cancelled). Any other symbol in the box counts as open.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Bases Task Rows makes no network requests. Sign in uses the GitHub device flow. Bases Task Rows sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Bases Task Rows sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Report bugs and feature requests in the issues, with your Obsidian version and a sample task line that shows the problem.

To build from source:

```
npm ci
npm run build
npm test
```

The tests cover reading and changing task lines in both formats.

## License

MIT

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
