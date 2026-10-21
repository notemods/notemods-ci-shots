# notemods-ci-shots

CI staging repo for NoteMods Obsidian plugins. Each branch `p/<slug>` holds one exported public plugin tree in `plugins/<slug>/`.
The `shots` workflow builds the plugin, opens it in the latest real Obsidian on Linux (wdio-obsidian-service under Xvfb),
runs each entry of the plugin's `qa.json`, and uploads `docs/<feature>.png`, `docs/<feature>.gif` and a run log as the artifact `shots-<slug>`.
It also runs the plugin's own end-to-end spec when it has one.

The `main` branch holds only the workflow and the runner in `ci/`. No secrets are used.
