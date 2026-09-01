# VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.

> [!DANGER]
> ### NEVER PR to upstream `microsoft/vscode`
>
> This repo is a private fork of `microsoft/vscode`. Proprietary work from this fork must never be sent to the upstream `microsoft/vscode` repository. This already happened once in `microsoft/vscode#324681`, which exposed private fork code in an upstream pull request.
>
> 1. Every PR MUST target the fork. Always:
>    `gh pr create --repo tomFelder/abstract-vscode-spike --base main --head <branch>`
> 2. NEVER run a bare `gh pr create`; it defaults the base to upstream `microsoft/vscode`.
> 3. NEVER click the "Create a pull request ... pull/new/..." link `git push` prints without first switching the base repository away from `microsoft/vscode`.
> 4. Before trusting any PR, verify it is not cross-repo:
>    `gh pr view <n> --repo tomFelder/abstract-vscode-spike --json isCrossRepository,baseRefName`
>    `isCrossRepository` MUST be `false` and the base MUST be this fork.
> 5. If a PR is ever opened against `microsoft/vscode`: immediately run `gh pr close <n> --repo microsoft/vscode`, scan the diff for secrets and rotate any that were exposed, delete the head branch, and tell the owner to file a GitHub Support request to purge the PR/diff. Support is the only way to fully remove it.

For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on `tomFelder/abstract-vscode-spike` (never upstream). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels are used as-is (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
