# Plans & handoff prompts

The prompts that drove (and will drive) the spike, kept verbatim so the thinking is reproducible.
These are the canonical copies; mirrors live in `~/.claude/plans/` for clean-session pickup.

| File | What it is |
|---|---|
| [00-spike-plan-and-outcomes.md](00-spike-plan-and-outcomes.md) | The original master plan (context, the vertical slice, the implementation plan, the reuse map) with the **spike outcomes + Item-5 de-IDE findings** appended. |
| [01-items-0-5-handoff.md](01-items-0-5-handoff.md) | The continuation prompt that drove items 0-5 (Markdown-by-default, fan-out, WYSIWYG, live API, export, Studio skin), captured verbatim, with a "how it went" footer. |
| [02-studio-de-ide-handoff.md](02-studio-de-ide-handoff.md) | The **next** handoff: make the shell match the Workbench hi-fi (Documents home, real theme, branded header, gutter redesign, Download-as-Markdown, file-format memo, merge-tax ledger). Start a clean session from this. |

## How to use a handoff
Paste the relevant file into a fresh Claude Code session. The handoffs are self-contained: repo /
branch / build / conventions / design source / ordered work items / verification. The Studio
handoff (02) is the live one to run next.
