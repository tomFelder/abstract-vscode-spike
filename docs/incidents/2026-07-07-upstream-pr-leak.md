# Incident: Upstream PR leak to microsoft/vscode

Date: 2026-07-07

## Summary

Pull request `microsoft/vscode#324681` was opened from the private fork `tomFelder/abstract-vscode-spike`, branch `debt-slot-count`, against upstream `microsoft/vscode:main`. The PR title was `fix: slot count ignores commented-out slots in templates`. GitHub records the PR as created at `2026-07-07T05:52:03Z` (`2026-07-07 15:52:03 Australia/Melbourne`).

The PR is now closed and was not merged. GitHub reports it as cross-repository, with `headRefName` `debt-slot-count`, `baseRefName` `main`, `state` `CLOSED`, and `mergedAt` `null`.

## Investigation

I searched retained Codex session transcripts, Codex state/log files, this repository, and shell histories for:

- `gh pr create`
- `debt-slot-count`
- `324681`
- `pull/new`
- `git push`

No retained shell history entry or Codex tool call shows the exact command or browser action that created `microsoft/vscode#324681`. In particular, I did not find a `gh pr create` invocation for branch `debt-slot-count`, a retained `pull/new` URL for this branch, or an interactive `gh pr create` transcript selecting the upstream base.

The retained evidence only shows the incident being discovered after creation. In Codex session `019f3a77-2928-7792-8b97-e3015cab7081`, a later investigation at `2026-07-07T07:18:15Z` listed:

```json
{"baseRefName":"main","headRefName":"debt-slot-count","isDraft":false,"number":324681,"state":"CLOSED","title":"fix: slot count ignores commented-out slots in templates","url":"https://github.com/microsoft/vscode/pull/324681"}
```

I also found a false lead in Codex session `019f3619-e4fa-78f3-af47-4617e3fbc2ee`: at `2026-07-06T06:41:25.859Z`, Codex ran:

```sh
git push origin 26-history-undo
```

That session was working on PR `#89` in this fork and is not the command that created upstream PR `#324681`.

## GitHub confirmation

The requested `gh pr view 324681 --repo microsoft/vscode --json state,merged,isCrossRepository,baseRefName,headRefName` command could not run exactly because this installed `gh` version does not expose a `merged` JSON field. I used the equivalent available fields:

```sh
gh pr view 324681 --repo microsoft/vscode --json state,closed,mergedAt,isCrossRepository,baseRefName,headRefName,headRepository,createdAt,url,title
```

Result:

```json
{"baseRefName":"main","closed":true,"createdAt":"2026-07-07T05:52:03Z","headRefName":"debt-slot-count","headRepository":{"id":"R_kgDOS_7HoA","name":"abstract-vscode-spike","nameWithOwner":""},"isCrossRepository":true,"mergedAt":null,"state":"CLOSED","title":"fix: slot count ignores commented-out slots in templates","url":"https://github.com/microsoft/vscode/pull/324681"}
```

The upstream PR search:

```sh
gh api "search/issues?q=repo:microsoft/vscode+type:pr+author:tomFelder&per_page=100" --jq '.total_count, (.items[]|{number,state,title})'
```

returned exactly one PR:

```json
1
{"number":324681,"state":"closed","title":"fix: slot count ignores commented-out slots in templates"}
```

Based on the requested search, `microsoft/vscode#324681` is the only PR by `tomFelder` in upstream `microsoft/vscode`.

## Likely cause

The exact creation action is not present in retained local history, so I cannot honestly attribute the leak to a specific recovered command. The most likely cause remains GitHub's fork default behavior: both a bare `gh pr create` and the post-`git push` browser "Create a pull request" link can default a fork's PR base to the parent repository, `microsoft/vscode`, unless the target repository is explicitly pinned to the fork.

## Guardrail

Root `AGENTS.md` now contains a prominent "NEVER PR to upstream `microsoft/vscode`" danger section requiring:

- `gh pr create --repo tomFelder/abstract-vscode-spike --base main --head <branch>`
- no bare `gh pr create`
- no trust in `git push` `pull/new` links unless the base repository is switched away from `microsoft/vscode`
- verification that trusted PRs are not cross-repository
- immediate closure, secret scan/rotation, branch deletion, and GitHub Support purge request if this ever recurs
