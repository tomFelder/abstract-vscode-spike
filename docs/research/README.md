# research/ - the user-evidence container

Everything in `docs/` above this folder is founder-derived hypothesis. **This folder is where
evidence from real users lands**, starting with cohort 1. It exists *before* the first session so
the most valuable asset the beta produces has a home from day one. The weekly digest of this
folder is what updates the [24-beta-success-memo.md](../24-beta-success-memo.md) scoreboard.

## What lands here

- **Session notes** - one file per onboarding/observation session:
  `YYYY-MM-DD-user##-session.md` (template: [session-note.template.md](session-note.template.md)).
- **Interview notes** - churn interviews, "this was wrong" follow-ups: `YYYY-MM-DD-user##-interview.md`.
- **Survey exports** - the onboarding survey results (daily-driver model, subscriptions, weekly
  output, team-vs-solo, price anchor).
- **Weekly digests** - `YYYY-Www-digest.md`: funnel numbers vs the memo's targets, VP evidence,
  top stumbles, quotes of the week.

## Rules

1. **Consent first.** Nothing is recorded beyond what the analytics consent covers; quotes are
   used with permission.
2. **Pseudonyms.** Users are `user01`, `user02`… here; the mapping lives outside the repo.
   No names, employers, or document contents - describe the *shape* of their work, never its text.
3. **Verbatim beats summary.** The user's words are the data ("I never ship a stale number" came
   from listening). Mark paraphrase as paraphrase.
4. **Stumbles are findings.** Every off-path stumble gets a journey ID
   ([26-glossary-and-id-index.md](../26-glossary-and-id-index.md)) and, if new, a GitHub issue -
   the session note links it.
5. **Disconfirming evidence is the point.** The memo's kill thresholds
   ([24](../24-beta-success-memo.md) §2) are checked against what's here, not against memory.
