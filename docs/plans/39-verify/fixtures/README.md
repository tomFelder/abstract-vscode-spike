# Plan 39 T1 audit fixtures

Clipboard payloads and documents used by the T1 editor-fundamentals audit
(`docs/plans/39-t1-editor-audit-loop.md`). **Honesty note (per the plan):
the Word `text/html` payloads are synthesised** to match what Word 2016+
actually puts on the clipboard (mso- style definitions, `<o:p>` empty runs,
`MsoListParagraphCxSp*` list paragraphs with `<![if !supportLists]>`
conditional markers, `MsoTableGrid` tables, smart-quote entities,
`msoIns`/`msoDel` tracked-change residue). Real-Word capture is not
available in the loop environment (Linux container, no Office).

| Fixture | What it probes |
|---|---|
| `word-clipboard-report.html` | THE gating payload: heading, smart quotes/em-dash, bold/italic/link, 2-level Word list, 6-row `MsoTableGrid` table with a merged (colspan=2) header cell, inline data-URI image, `msoIns`/`msoDel` tracked-changes residue |
| `word-clipboard-simple.html` | Minimal Word paragraph: smart quotes, bold, italic, link |
| `plain-text.txt` | `text/plain`-only paste |
| `longdoc-10k.md` | ~10,000-word / 43-section document for area 8 (long-doc ergonomics) |

The payloads are injected as `ClipboardEvent('paste')` with a `DataTransfer`
carrying `text/html` (and a `text/plain` fallback), dispatched inside the
editor webview — the same paste path a real Ctrl+V takes through the browser
into ProseMirror's clipboard handler.
