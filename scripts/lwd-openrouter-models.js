/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// The OpenRouter model catalogue: a CURATED ALLOWLIST, not a mirror of everything OpenRouter serves.
//
// Why an allowlist. OpenRouter fronts several hundred models of wildly varying quality. This product asks a
// model to do one narrow, unforgiving job - read a document plus its sources and return a STRUCTURED edit set
// whose `oldText` must quote the live prose exactly - and most models fail that job in ways that surface as
// silent no-ops rather than errors (issue #303). So the picker offers only models a human has actually watched
// do the job, and every other id is simply absent.
//
// The validation workflow this file exists to support:
//
//   1. Add a candidate below with `validated: false`. It is inert - never offered, never served.
//   2. Run the broker with LWD_OPENROUTER_INCLUDE_UNVALIDATED=1 to expose candidates in the picker, and drive
//      the real walk against it (ask for a multi-paragraph rewrite; check the edits actually queue).
//   3. If it holds up, flip `validated: true` and record `validatedOn` + a one-line `notes` verdict.
//
// Two escape hatches mean a new model NEVER requires a code change to try:
//   - `~/.abstract/models.json` -> `openrouter.models` overlays this list entirely (same file and shape the
//     openai-oauth door already uses; see lwd-openai-oauth.readModelsConfig). Adding an id there IS the act of
//     validating it, so overlay entries are always treated as validated.
//   - OPENROUTER_MODEL still forces a single id, unchanged, for a one-off run.
//
// Discovery: `GET /models/openrouter/catalogue` on the broker intersects this list with OpenRouter's live
// /api/v1/models and reports which curated ids upstream actually serves right now. That is the honest way to
// check a candidate's slug before promoting it - do not trust the id strings below to be current on their own.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// --- the curated list ------------------------------------------------------------------------------------
// `id` is the OpenRouter slug exactly as it must be sent upstream. `label` is what the picker shows - product
// language, never the raw slug. Exactly one entry carries `default: true` among the VALIDATED entries.
//
// NOTE ON THE CANDIDATE SLUGS: the `validated: false` rows below are starting points for step 1 above, not
// confirmed ids. OpenRouter renames and retires slugs, so confirm each against /models/openrouter/catalogue
// before promoting it. A wrong slug in a candidate row is harmless - it is never served while unvalidated.
const OPENROUTER_MODELS = [
	// --- validated -----------------------------------------------------------------------------------
	{
		id: 'anthropic/claude-sonnet-5',
		label: 'Included (planner)',
		default: true,
		validated: true,
		validatedOn: '2026-08-20',
		notes: 'Approved as BOTH the included planner and the rewrite author by founder ruling 9.3 '
			+ '(docs/30-editing-architecture.md section 9, folded into 2.2). Chosen over Sonnet 4.6, which is '
			+ 'absent from Anthropic\'s structured-outputs support list, and carrying intro pricing to 31 Aug. '
			+ 'Validated by ruling, not yet by a live walk: the validation walk re-confirms it at the next '
			+ 'founder smoke (issue #345).',
	},
	{
		id: 'openai/gpt-4.1-mini',
		label: 'Included (fast)',
		validated: true,
		validatedOn: '2026-07-10',
		notes: 'The founder-funded fallback since plan 35, DEMOTED from default by doc 30 section 2.2. Reliable '
			+ 'on single-paragraph edits; weak on multi-paragraph rewrites and on holding the JSON edit contract '
			+ '(a contributing cause of #303). Still offered - it is the cheapest thing on the door - but it no '
			+ 'longer answers a call that named no model.',
	},

	// --- candidates: inert until validated (step 1 above) ---------------------------------------------
	// Frontier tiers, for the quality problem this list exists to fix. Confirm each slug before promoting.
	{ id: 'anthropic/claude-opus-4.8', label: 'Opus 4.8', validated: false, notes: 'Candidate: strongest expected on the structured-edit contract. Opus-as-planner with Sonnet-as-applier is the stated aspiration if margins allow (ruling 9.3); not now.' },
	{ id: 'anthropic/claude-sonnet-4.6', label: 'Sonnet 4.6', validated: false, notes: 'Candidate, superseded by Sonnet 5: absent from Anthropic\'s structured-outputs support list (doc 30 section 2.2).' },
	{ id: 'openai/gpt-4.1', label: 'GPT-4.1', validated: false, notes: 'Candidate: the named fallback planner in doc 30 section 2.2, and the full-size sibling of the demoted mini.' },
	{ id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', validated: false, notes: 'Candidate: long-context door for whole-project fan-out.' },
];

/** Where the shared per-backend model config lives (same file the openai-oauth door overlays from). */
function modelsConfigPath() {
	const home = process.env.HOME || os.homedir();
	return path.join(home, '.abstract', 'models.json');
}

let warnedBadConfig = false;
function warnBadModelsConfig(detail) {
	if (warnedBadConfig) { return; }
	warnedBadConfig = true;
	console.error(`[lwd-proxy] ignoring ~/.abstract/models.json for openrouter: ${detail}; using the built-in curated list`);
}

/**
 * Read the `openrouter` slice of ~/.abstract/models.json. Mirrors lwd-openai-oauth.readModelsConfig exactly:
 * a missing file or missing slice is the silent common case (use the built-ins); a malformed one warns ONCE
 * and degrades to the built-ins rather than emptying the picker. Returns null when there is no usable override.
 * @returns {{ models?: { id: string, label: string }[], default?: string } | null}
 */
function readModelsConfig() {
	let raw;
	try { raw = fs.readFileSync(modelsConfigPath(), 'utf8'); }
	catch { return null; } // no file -> built-ins (the common, non-error case)
	let parsed;
	try { parsed = JSON.parse(raw); }
	catch { warnBadModelsConfig('models.json is not valid JSON'); return null; }
	if (!parsed || typeof parsed !== 'object') { warnBadModelsConfig('models.json is not a JSON object'); return null; }
	const slice = parsed.openrouter;
	if (slice === undefined) { return null; } // no openrouter slice -> built-ins, no warning
	if (!slice || typeof slice !== 'object') { warnBadModelsConfig('"openrouter" is not an object'); return null; }
	const out = {};
	if (slice.models !== undefined) {
		if (!Array.isArray(slice.models)) { warnBadModelsConfig('"openrouter.models" is not an array'); return null; }
		const models = [];
		for (const m of slice.models) {
			if (!m || typeof m.id !== 'string' || !m.id) { continue; } // skip a malformed entry, keep the rest
			models.push({ id: m.id, label: (typeof m.label === 'string' && m.label) ? m.label : m.id });
		}
		if (models.length) { out.models = models; }
		else { warnBadModelsConfig('"openrouter.models" had no usable entries'); }
	}
	if (typeof slice.default === 'string' && slice.default) { out.default = slice.default; }
	return (out.models || out.default) ? out : null;
}

/** True when candidates (validated:false) should be exposed for a validation run. */
function includeUnvalidated() {
	const v = process.env.LWD_OPENROUTER_INCLUDE_UNVALIDATED;
	return v === '1' || v === 'true';
}

/**
 * The models the OpenRouter door offers, shaped for the composer picker: `{ id, label, default }`, with
 * exactly one default whenever the list is non-empty.
 *
 * Precedence, highest first:
 *   1. OPENROUTER_MODEL - a forced single id (dev/one-off override), offered alone.
 *   2. ~/.abstract/models.json -> openrouter.models - an operator overlay; entries count as validated.
 *   3. The curated list above, filtered to `validated: true` (plus candidates when the env flag is set).
 *
 * Never returns an empty list: if every path yields nothing, the built-in default id is offered alone, so the
 * picker cannot empty and a call can always resolve onto something.
 *
 * Each entry carries `validated`, which the broker's merged catalogue republishes per model (plan 55 WP-B3):
 * a curated row reports its own `validated` flag, while a forced id and an operator overlay entry are BOTH
 * validated by construction - naming an id in `OPENROUTER_MODEL` or in `~/.abstract/models.json` is itself the
 * act of validating it (see the escape hatches at the head of this file).
 * @param {{ includeUnvalidated?: boolean }} [opts]
 */
function listModels(opts) {
	const forced = process.env.OPENROUTER_MODEL;
	if (forced) {
		return [{ id: forced, label: 'Included model', default: true, validated: true }];
	}
	const config = readModelsConfig();
	const wantUnvalidated = (opts && typeof opts.includeUnvalidated === 'boolean') ? opts.includeUnvalidated : includeUnvalidated();
	// An operator overlay replaces the curated list wholesale - adding an id there is the act of validating it.
	const base = (config && config.models)
		? config.models.map(m => ({ id: m.id, label: m.label, default: false, validated: true }))
		: OPENROUTER_MODELS
			.filter(m => m.validated === true || wantUnvalidated)
			.map(m => ({ id: m.id, label: m.label, default: m.default === true, validated: m.validated === true }));
	if (!base.length) {
		return [{ id: builtInDefaultId(), label: 'Included model', default: true, validated: true }];
	}
	// Resolve the single default: an operator-named default that is in the effective list wins, else the list's
	// own flagged default, else its first entry. Mirrors the openai-oauth resolution so both doors behave alike.
	const named = config && config.default && base.some(m => m.id === config.default) ? config.default : undefined;
	let defaulted = false;
	const withDefault = base.map(m => {
		const isDefault = named ? m.id === named : (m.default === true && !defaulted);
		if (isDefault) { defaulted = true; }
		return { id: m.id, label: m.label, default: isDefault, validated: m.validated === true };
	});
	if (!defaulted) { withDefault[0].default = true; }
	return withDefault;
}

/** The built-in default slug - the validated entry flagged default, else the first validated one. */
function builtInDefaultId() {
	const validated = OPENROUTER_MODELS.filter(m => m.validated === true);
	const flagged = validated.find(m => m.default === true);
	return (flagged && flagged.id) || (validated[0] && validated[0].id) || OPENROUTER_MODELS[0].id;
}

/**
 * The id a request lands on when it carries no model, or one this door does not offer. Kept here (rather than
 * derived at the call site) so the door has ONE answer to "what do we serve by default".
 */
function defaultModelId() {
	const list = listModels();
	const flagged = list.find(m => m.default);
	return (flagged && flagged.id) || (list[0] && list[0].id) || builtInDefaultId();
}

module.exports = {
	OPENROUTER_MODELS,
	listModels,
	readModelsConfig,
	defaultModelId,
	builtInDefaultId,
	includeUnvalidated,
	get MODELS_CONFIG_PATH() { return modelsConfigPath(); },
};
