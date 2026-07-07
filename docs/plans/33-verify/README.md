# Plan 33 verification notes

## Removed titlebar screenshots

`before-02-titlebar.png` and `after-02-titlebar.png` were removed as invalid evidence.
The two files were byte-identical (matching MD5), so they showed no before/after difference and provided zero proof of the L1/L2 chrome removal.

Instead, the L1/L2 chrome removal was verified live by DOM probe (per the validation comment on PR #90), which is the authoritative check for the deregistered container ids and hidden titlebar surfaces.
