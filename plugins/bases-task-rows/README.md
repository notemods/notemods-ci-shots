# Bases Task Rows

Bases Task Rows adds two views to Bases. "Task rows" shows each checklist task in the notes of a base as its own row, with its dates, priority, tags, source note and heading. Tick a box in the view and the plugin writes the change to that line. "Task progress" shows one row for each note, with its open and done task counts.

The view, the done box, sorting, filtering, a tag filter with a Next task column, and up to 200 tasks per view are free. Pro removes the limit and adds groups, due date editing in the row, bulk actions, and the next occurrence of a recurring task. Pro costs $5 a month, or $15 once, through GitHub Sponsors.

## Features

### One row per task

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/task-rows.png" alt="A base with 150 tasks from 30 notes, one row per task, with due date, scheduled date, priority, tags, note and heading" width="720">

The base filters decide which notes count. The view then lists the task lines, such as `- [ ]` and `- [x]`, in those notes. A task-like line inside a code block does not count.

Select the task text or the note name to open the note at that line.

### Tick a task from the view

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/bases-task-rows.gif" alt="Ticking two tasks in the Task rows view, and the source note shows the x and the done date" width="720">

Tick the box and the plugin changes `[ ]` to `[x]` in the source line. If the line has a date, it also adds a done date (`✅ 2026-10-10` or `[completion:: 2026-10-10]`), like the Tasks plugin.

The plugin writes only when the line is still the line it read. Else a notice tells you. Other lines do not change.

### Sort and filter

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/filter.png" alt="The filter box with the word budget, which leaves only the matching tasks" width="720">

The toolbar has a filter box, a Show menu, a Sort menu and a reverse button. The filter matches task text, tags, note and heading.

### Tasks emoji and Dataview fields

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/dataview-dates.png" alt="Tasks from meeting notes written with Dataview fields, with their due dates and priorities in the columns" width="720">

The plugin reads these parts of a task line:

- Dates in Tasks format: `📅` due, `⏳` scheduled, `🛫` start, `✅` done, `➕` created, `❌` cancelled.
- The same dates as Dataview fields in square or round brackets: `due`, `scheduled`, `start`, `completion`, `created`, `cancelled`.
- Priority: `🔺 ⏫ 🔼 🔽 ⏬`, or `[priority:: high]`.
- Tags, but not `#123` and not tags in code.

Dates can also be ISO date links, such as `📅 [[2026-10-18]]`, and an edit keeps the brackets. An invalid date, a slash date or a date in a code span does not set a date column.

The Task column shows the text without these parts. A new date uses the format of the line, or the setting "Format of new dates".

### Task progress for each note

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/task-progress.png" alt="The Task progress view with one row per project note: open, done and total tasks, a progress bar, the next due date and the overdue count" width="720">

The "Task progress" view shows one row for each note in the base, with the columns Note, Open, Done, Total, Progress, Next due and Overdue. `x` and `X` count as done. A cancelled task (`-`) is not in any count. Progress is done divided by total, as a bar and a whole percent. Next due is the earliest due date of an open task. Overdue counts the open tasks due before today.

Select a row to open the note. This view never changes a note. Free shows 200 notes.

### Count only tasks with a tag, and the Next task column

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/next-task.png" alt="The Task progress view with Count only tasks with tag set to waiting: each project note shows its open waiting tasks and the text of the first one in the Next task column" width="720">

Type a tag such as `#next-action` in the view option "Count only tasks with tag". The counts then use only the tasks with that tag in the task line. A "Next task" column shows the first open task with that tag in each note, so an empty cell shows a project with no next step. `#next` also counts `#next/call`. A tag has no spaces, so use `#next-action` for "next action". Spaces and commas separate tags.

Pro counts several tags and adds the toggle "Only notes without a next task".

### Groups by date, note, heading or tag (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/date-groups.png" alt="Open tasks grouped under Overdue, Today, Next 7 days, Later and No date" width="720">

Group by date puts each open task under Overdue, Today, Next 7 days, Later or No date. You can also group by note, heading or tag.

### Edit due dates, move to today, complete many (Pro)

<img src="https://raw.githubusercontent.com/theluckystrike/bases-task-rows/HEAD/docs/bulk-actions.png" alt="Three selected rows, the Complete selected and Move selected to today buttons, and a date picker open in a due cell" width="720">

With Pro you can:

- Select a due date to change it. Press Enter to save, Escape to cancel. An empty date removes the due date.
- Select the calendar button of a row to move the task to today.
- Select rows with the boxes on the left, then select "Complete selected" or "Move selected to today". "Complete selected" skips done and cancelled tasks.
- Tick a recurring task (a rule like "every week") to write the next occurrence on the line below.

## Install

In Obsidian, open Settings, then Community plugins, then Browse, and search for "Bases Task Rows". Select Install, then Enable.

The plugin needs Obsidian 1.13.4 or newer with the Bases core plugin on. It was tested on desktop with Obsidian 1.13.4 and 1.14.4.

## Usage

1. Open a folder of notes with tasks and run the command "Create a task base for the current folder". The plugin creates `Tasks.base` in that folder with a Task rows view and a Task progress view, and opens it.
2. Or open any base, select the view menu, add a view, and choose the layout "Task rows" or "Task progress".
3. Change the base filters to choose the notes. Change Show, Sort and the columns in the toolbar or in the view options.

Both views update by themselves when a note changes.

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
| Task progress view: Sort by, Sort highest first, Show notes without tasks | Progress, off, off | Progress, Open tasks, Next due or Note name; on or off; on or off |
| Task progress view: Count only tasks with tag, Only notes without a next task (Pro) | Empty, off | Tags; on or off |

Auto adds a done date only to lines with a date.

## FAQ

### Does it change my notes?

Only when you tick a box or use a Pro action. Then it changes only the box and the done date, or one date, in that one line. With Pro, a tick on a recurring task also adds one new line below it.

### Which statuses count as done?

`x`, `X` and `-` (cancelled). Any other symbol in the box counts as open. The Task progress view leaves cancelled tasks out of its counts.

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

## License

MIT

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
