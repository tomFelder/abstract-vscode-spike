# Prediction-Driven Hardening Checklists

Abstract does not keep standing checklists of *predicted* failure modes as open tracking issues. Robustness work is scheduled from evidence: a cohort session, a QA audit, or a reproduced defect.

## What this is not

This is not a rejection of real-folder robustness. That work is squarely in scope and has shipped: the external-edits-while-open floor (detect an outside change, offer reload or keep, never silently clobber, with an audit entry that survives a relaunch) landed in the file-reality wave via PR #250, live-proven on the packaged desktop app. Filename reality, big-folder first-open, cloud-sync conflict copies and the rest remain things Abstract should handle honestly.

What is out of scope is the *artefact*: a long-lived issue enumerating breaks nobody has hit yet, held open as a queue for someone to work down.

## Why this is out of scope

A prediction list is a forecast, and its rows age at different rates. Some get overtaken by architecture (the change store and the lock-file design answered parts of the lock-file row on their own), some get answered as a side effect of unrelated work (the import refusal states covered half the legacy-format row; the F19 rehydration proof exercised lock rebuildability), and some describe a user who does not exist yet. Because nothing forces a row to be re-scored, the checklist keeps its original shape long after the reasoning behind it has moved, and the ticked rows stop reflecting where the product actually is.

The deeper problem is that a predicted break competes for attention with a real one on equal footing. An open row reads like outstanding work whether or not any user has ever hit it, so the list quietly inflates the backlog and dilutes the signal from issues that came from someone actually using the product.

Abstract already has a better generator. The evidence-driven passes have a track record of producing sharper, better-specified issues than the prediction lists did: the July UX audit found a severed Agents entry point that no prediction anticipated, and the plan-52 defect backlog came out of measured journeys rather than forecast ones. Those passes name a reproduction, a code path and a floor, which is what makes an issue actionable by an agent or a human. A row like "privacy flinch: what-the-agent-sees has a plain-words answer" cannot be handed to anyone as written.

The predictions themselves are not lost. They live in `docs/21-beta-v1-prioritization.md` §6 and `docs/04-risks-and-predictions.md`, which is the right home for a forecast: a document that can be read, revised and disagreed with, rather than a ticket that can only be ticked. When a cohort session or an audit hits one of these failure modes, it gets filed as its own issue with a reproduction, and it inherits the pattern PR #250 established (probe, plain-words floor, evidence directory).

## What to do instead

File the specific break when it is observed, not the category in advance. If a class of failure genuinely needs proactive coverage before a user meets it, schedule a QA pass that goes looking for it and file what that pass finds. The pass is the work; the findings are the issues.

## Prior requests

- #133: "[P2] Real-folder hardening: turn the doc 21 §6 predictions into probes and floors"
