# 387 - a blank document accepts typing (#320)

Captured in the web build (`./scripts/code-web.sh ./living-docs-sample`, bare `http://localhost:8080/`) at 1440x900, driven over CDP. Both runs walk the identical path: Home > New document > **Blank document**, then click the middle of the reading column and type "Hello from a brand new blank document.".

| | reading column (`#pm-root`) | editor mount (`.ProseMirror`) | what the typing did |
| --- | --- | --- | --- |
| before | `0px` | `0px` | nothing - the surface has no width, so there is nowhere for the caret to go |
| after | `538px` | `538px` | the sentence lands on the page and the document saves |

`before-blank-doc-cannot-be-typed-into.png` is the state *after* the typing attempt: the page is still empty, because the click never reached an editing surface. An empty document looks the same either way - the fault only shows when you try to write - so the measurements above and the S4 test (`src/vs/workbench/contrib/livingDocs/test/browser/blankDocTyping.test.ts`) are the load-bearing proof.
