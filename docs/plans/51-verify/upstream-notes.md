# Plan 51 WP-A - upstream research notes (device-authorization flow)

**Purpose.** Everything the broker's device-auth core needs, read from *live* sources at implementation time (3 Aug 2026), not from model training data. Each claim links to the exact file and line at a pinned commit so the validator can independently re-trace it.

**Primary source.** The official OpenAI Codex CLI (`github.com/openai/codex`, Rust workspace under `codex-rs/`). Pinned commit: `bb5054fe47abe73ecbbd454751066a28c89f4bb9` (repo `main` HEAD on 3 Aug 2026). Use `https://github.com/openai/codex/blob/bb5054fe47abe73ecbbd454751066a28c89f4bb9/<path>#L<n>` to view any line quoted below.

## 0. The one big correction to prior assumptions

The plan's WP-A row says "RFC 8628 device-authorization flow". **The real OpenAI/Codex device flow is NOT textbook RFC 8628.** It is a bespoke JSON flow OpenAI runs under `/api/accounts/deviceauth/*`:

- It does **not** POST form-encoded `grant_type=urn:ietf:params:oauth:grant-type:device_code` to a token endpoint.
- It does **not** return the RFC error strings `authorization_pending` / `slow_down` / `expired_token` / `access_denied` in a JSON `error` field. Instead the **poll endpoint signals "still pending" with HTTP 403 or 404**, success with HTTP 2xx, and any other status is a hard failure.
- On success the poll endpoint returns a server-minted **`authorization_code` plus the PKCE `code_verifier` and `code_challenge`** (the server generates the PKCE pair for you), which you then exchange at the ordinary OAuth `/oauth/token` endpoint for the real tokens.

Our broker's *external contract* (frozen on issue #283: `userCode`, `verificationUri`, `verificationUriComplete?`, `expiresIn`, `interval`, and a `status` state machine) is an RFC-8628-shaped abstraction we present to the UI. Internally we drive the real Codex JSON flow and *map* its 403/404-means-pending semantics onto our `pending` state, its timeout onto `expired`, and any hard status onto `error`. The frozen contract is honoured exactly; only the wording "RFC 8628" in the plan is imprecise about the wire format. See §5 for the mapping table.

## 1. Client id

`app_EMoamEEZ73f0CkXaXp7hrann` - a **public** PKCE OAuth client (no secret), so shipping the id is expected and safe.

- Source: `codex-rs/login/src/auth/manager.rs:1448` - `pub const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";`
- Overridable via env `CODEX_APP_SERVER_LOGIN_CLIENT_ID` (`manager.rs:195`, used by `oauth_client_id()` at `manager.rs:1451`).
- This matches the value already hardcoded in our `scripts/lwd-openai-oauth.js:41`, independently re-confirmed live.

## 2. Issuer / base URL

`https://auth.openai.com` (the "issuer"). All device-auth and token URLs are built from it.

- Source: `codex-rs/login/src/server.rs:59` - `pub(super) const DEFAULT_ISSUER: &str = "https://auth.openai.com";`
- Refresh endpoint constant: `codex-rs/login/src/auth/manager.rs:191` - `const REFRESH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";`

We make the issuer overridable via env `LWD_OPENAI_AUTH_BASE` (default `https://auth.openai.com`) so the broker can be pointed at the local stub.

## 3. Device-auth endpoints (the bespoke JSON flow)

All under `{issuer}/api/accounts` (`device_code_auth.rs:170` - `let api_base_url = format!("{base_url}/api/accounts");`).

### 3a. Request the user code

`POST {issuer}/api/accounts/deviceauth/usercode`

- Source: `device_code_auth.rs:68` - `let url = format!("{auth_base_url}/deviceauth/usercode");`
- Request body (JSON, `Content-Type: application/json`): `{ "client_id": "<CLIENT_ID>" }` (`UserCodeReq`, `device_code_auth.rs:37-39`).
- Response body (JSON): `{ "device_auth_id": "<opaque>", "user_code": "<code>", "interval": <seconds> }` (`UserCodeResp`, `device_code_auth.rs:27-34`). Note: `user_code` accepts aliases `usercode`; `interval` may arrive as a *string* and is parsed to a number (`deserialize_interval`, `device_code_auth.rs:47-53`).
- A `404` here means "device code login is not enabled for this Codex server" (`device_code_auth.rs:83-88`).

### 3b. The verification URL shown to the human

`{issuer}/codex/device` - i.e. `https://auth.openai.com/codex/device`.

- Source: `device_code_auth.rs:174` - `verification_url: format!("{base_url}/codex/device")`.
- The user opens this URL and **types the `user_code`** (there is no upstream `verification_uri_complete` that embeds the code). Our frozen contract's `verificationUriComplete` is therefore **optional and omitted** for the real upstream (we only populate it when a stub/upstream supplies one). `expiresIn` we report as `900` (15 minutes; see §4).

### 3c. Poll for the authorization code

`POST {issuer}/api/accounts/deviceauth/token`

- Source: `device_code_auth.rs:107` - `let url = format!("{auth_base_url}/deviceauth/token");`
- Request body (JSON): `{ "device_auth_id": "<from 3a>", "user_code": "<from 3a>" }` (`TokenPollReq`, `device_code_auth.rs:41-45`).
- **Poll semantics** (`poll_for_token`, `device_code_auth.rs:100-147`):
  - HTTP **2xx** -> approved. Body is `{ "authorization_code": "...", "code_challenge": "...", "code_verifier": "..." }` (`CodeSuccessResp`, `device_code_auth.rs:55-60`). The **server generated the PKCE pair**; we use its `code_verifier` for the exchange.
  - HTTP **403 or 404** -> still pending; sleep `interval` seconds and poll again (`device_code_auth.rs:131-140`).
  - Any **other** status -> hard failure, stop (`device_code_auth.rs:142-145`).
  - **Overall timeout: 15 minutes** (`max_wait = Duration::from_secs(15 * 60)`, `device_code_auth.rs:108`), after which it errors "device auth timed out after 15 minutes" (`device_code_auth.rs:132-135`). We map this to `state: "expired"`.
  - Sleep is `Duration::from_secs(interval).min(max_wait - elapsed)` (`device_code_auth.rs:137`) - never sleep past the deadline.

## 4. Poll interval and expiry

- **Interval** is whatever the `usercode` response returns (`interval` field, §3a). Codex has no separate default; if the field is absent it deserialises to `0`. We defend against a `0`/absent interval by flooring it to **5 seconds** (a sane RFC-8628-style default, matching the frozen contract's example `interval: 5`). The frozen contract requires the UI never polls faster than `interval`, so a floor only makes us politer.
- **`slow_down` back-off:** the real upstream does not send an RFC `slow_down` JSON error - it just holds on 403/404. But our frozen contract and the plan require honouring `slow_down` (the stub emits it, and a future upstream might). We therefore treat *either* signal as "increase the interval": on the JSON `{ "error": "slow_down" }` shape we bump the interval by 5s (RFC 8628 §3.5 convention) and keep polling. This is additive and never fires against today's real upstream.
- **`expiresIn`:** we report `900` (15 min) to the UI - the exact window Codex enforces on the poll loop (§3c) and the "expires in 15 minutes" text in the Codex prompt (`device_code_auth.rs:155`).

## 5. State mapping (real upstream -> our frozen `/auth/openai/status` states)

| Our `state` | Trigger |
|---|---|
| `signed-out` | No pending flow and no stored bundle. |
| `pending` | Flow started; poll returning 403/404 (or JSON `authorization_pending`/`slow_down`). |
| `signed-in` | Poll returned 2xx, code exchanged for tokens, bundle written. |
| `expired` | 15-minute deadline passed with no approval (or JSON `expired_token`). |
| `error` | Any hard failure - poll returned a non-2xx/403/404 status, exchange failed, or JSON `access_denied`. `reason` carries plain words; the broker's `ok:false` failure shape also carries `upstreamStatus`/`upstreamBody` when the failure came from an upstream HTTP response. |

We *also* honour the textbook RFC 8628 JSON `error` strings (`authorization_pending`, `slow_down`, `expired_token`, `access_denied`) when a token response arrives with HTTP 200 + a JSON `error` field, because (a) the stub uses them to exercise every branch deterministically and (b) they are the documented fallback if OpenAI ever returns the standard shape. Precedence: HTTP-status semantics first (403/404 = pending), then any JSON `error` field.

## 6. Token exchange (authorization_code -> tokens)

`POST {issuer}/oauth/token`, `Content-Type: application/x-www-form-urlencoded`.

- Source: `codex-rs/login/src/server.rs:809-876` (`exchange_code_for_tokens`), endpoint `server.rs:827` - `format!("{}/oauth/token", issuer...)`.
- Body (`server.rs:838`): `grant_type=authorization_code&code={code}&redirect_uri={redirect_uri}&client_id={client_id}&code_verifier={code_verifier}` (each value URL-encoded).
- **`redirect_uri` for the device flow** is `{issuer}/deviceauth/callback` (`device_code_auth.rs:202` - `format!("{base_url}/deviceauth/callback")`), NOT the loopback `http://localhost:1455/auth/callback` (that loopback redirect is only for the browser-redirect flow, `server.rs:176`).
- Response (JSON, `TokenResponse`, `server.rs:818-822`): `{ "id_token": "...", "access_token": "...", "refresh_token": "..." }`. **No `expires_in` field** - expiry is read from the access_token / id_token JWT `exp` claim (see §8).

## 7. Refresh

`POST https://auth.openai.com/oauth/token`, **`Content-Type: application/json`** (JSON, not form-encoded - differs from the code-exchange!).

- Source: `codex-rs/login/src/auth/manager.rs:1336-1376` (`request_chatgpt_token_refresh`), request struct `RefreshRequest` (`manager.rs:1434-1438`).
- Body (JSON): `{ "client_id": "<CLIENT_ID>", "grant_type": "refresh_token", "refresh_token": "<token>" }`. **No `scope` field** (our current loopback code sends `scope` on refresh - the live flow does not).
- Response (`RefreshResponse`, `manager.rs:1441-1445`): `{ "id_token"?, "access_token"?, "refresh_token"? }` - all optional; when `refresh_token` is absent we keep the existing one.
- Permanent-failure error codes (stop, force re-auth) read from the body's `error.code` / `error` / `code` (`extract_refresh_token_error_code`, `manager.rs:1408-1432`): `refresh_token_expired`, `refresh_token_reused`, `refresh_token_invalidated`; plus HTTP 401. Anything else is transient (`classify_refresh_token_failure`, `manager.rs:1378-1406`).

## 8. Scopes

`openid profile email offline_access api.connectors.read api.connectors.invoke`

- Source: `codex-rs/login/src/server.rs:589` (the authorize-URL builder's `scope` param). `offline_access` is what grants the refresh token.
- Note: scopes are only sent on the *authorize* step of the browser flow. The device flow's `usercode` request carries only `client_id`; the scope is bound server-side to the device auth session. We record the granted scopes in the bundle for the frozen-contract "granted scopes" field, defaulting to this string.

## 9. Account id + expiry from the id_token JWT

- The `id_token` is a JWT; its OpenAI auth claim `https://api.openai.com/auth` carries `chatgpt_account_id` (the billing account the Responses backend needs). Source: `codex-rs/login/src/token_data.rs:77` (`#[serde(rename = "https://api.openai.com/auth")]`) and `token_data.rs:96` (`chatgpt_account_id`). Our existing `accountIdFromIdToken` already reads exactly this claim - re-confirmed live.
- **Expiry** is the JWT `exp` claim (`token_data.rs:104` `exp: Option<i64>`, parsed by `parse_jwt_expiration`, `token_data.rs:130-134`). Codex reads it off the **access_token** JWT to decide refresh (`should_refresh_proactively`, `manager.rs:2510-2533`). Since the token endpoint returns no `expires_in`, we derive `expires_at` from the access_token's `exp` claim, falling back to a conservative default only if the token is opaque.
- **Refresh window:** Codex refreshes when `exp <= now + 5 minutes` (`CHATGPT_ACCESS_TOKEN_REFRESH_WINDOW_MINUTES = 5`, `manager.rs:183`) or, as a fallback with no JWT exp, when the last refresh was more than 8 days ago (`TOKEN_REFRESH_INTERVAL = 8`, `manager.rs:182`). We adopt a 5-minute pre-expiry skew.

## 10. New-set model ids (the Codex subscription catalogue) - CORRECTED 3 Aug 2026 from live docs

The subscription (Codex) path serves the **`gpt-5.6`** family; the OAuth bundle carries *no* model-listing entitlement (the Responses backend at `chatgpt.com/backend-api/codex/responses` exposes no models route the token is scoped for), so the id set WP-A ships is a static capability list, not a live enumeration.

**Important correction.** An earlier draft of this note listed `gpt-5-codex` / `gpt-5` / `gpt-5-mini`. Those are several generations stale (that is what model *training data* remembers, which is exactly what the plan forbids). The pinned Codex repo (commit `bb5054f`) no longer hardcodes model presets at all - `codex-rs/models-manager/src/model_presets.rs` now reads *"Hardcoded model presets were removed; model listings are now derived from the active catalog."* and its only remaining constants reference `gpt-5.1`/`gpt-5.1-codex-max` migration keys - so the live ids must come from OpenAI's current Codex docs, not the repo.

**The current ChatGPT-sign-in Codex catalogue (live docs, 3 Aug 2026):**

| Slug | Tier label | Role |
|---|---|---|
| `gpt-5.6-sol` | Sol | Flagship; **the default** at the Power preset / medium reasoning. |
| `gpt-5.6-terra` | Terra | Everyday workhorse. |
| `gpt-5.6-luna` | Luna | Fast / most affordable. |

- Source (default + catalogue): OpenAI Codex "Models" doc, `https://developers.openai.com/codex/models` (308-redirects to `https://learn.chatgpt.com/docs/models`) - *"Codex offers three GPT-5.6 models: Sol for detail and polish, Terra as the everyday workhorse, and Luna for clear, repeatable work. Start with the default Power setting, which uses gpt-5.6-sol with medium reasoning."*
- Corroboration (tier names + slugs): OpenAI's GPT-5.6 launch post `https://openai.com/index/gpt-5-6/` and `https://openai.com/index/previewing-gpt-5-6-sol/`; the Codex changelog `https://learn.chatgpt.com/docs/changelog` records the 31 Aug 2026 retirement of `gpt-5.4`/`gpt-5.4-mini` for ChatGPT sign-in, with `gpt-5.6-terra`/`gpt-5.6-luna` as the named replacements.
- Note on labels: "Sol / Terra / Luna" are **OpenAI's own tier names**, not a fork invention - they are literally the slug suffixes (`gpt-5.6-sol` etc.). This matches the fork's `IModelOption.label` convention from issue #179 (`livingDocs.ts:102` cites the ChatGPT tiers "Sol"/"Terra"/"Luna"), so `listModels()` maps slug -> label 1:1.
- These are the ids our `listModels()` returns; the Responses request's `model` field is set to the resolved id. WP-D turns this list into data (`~/.abstract/models.json` overlay) so the next rename never needs a broker edit; WP-A keeps the static list.

**Traceability note for the validator:** model ids remain the softest claim because the Responses backend has no live catalogue route the OAuth token can enumerate - the evidence is OpenAI's live Codex docs above, not a wire probe. The tier names are stable across the 5.6 generation; when OpenAI next renames (as the 5.4->5.6 migration shows they do), WP-D's config overlay is the intended fix path, not a WP-A code change. The `LWD_OPENAI_MODEL` env override also lets the founder pin a slug without a code edit.

## 11. What this means for `scripts/lwd-openai-oauth.js`

- Replace the loopback-PKCE `start()` with a **device-code** `start()`: POST `usercode`, return `{ userCode, verificationUri, verificationUriComplete?, expiresIn, interval }`, and hold `{ device_auth_id, user_code, interval, startedAt }` as the pending flow. Idempotent while pending (same code until the 15-min expiry).
- A **poll loop** honouring the 403/404-pending semantics (and the JSON RFC error fallbacks), the interval, `slow_down` back-off, the 15-min deadline (`expired`), and hard-error stop.
- On 2xx: exchange the server's `authorization_code` + `code_verifier` at `/oauth/token` (form-encoded, `redirect_uri = {issuer}/deviceauth/callback`), stamp expiry from the access_token JWT, write the 0600 bundle.
- Refresh switches to **JSON** body, drops `scope`, and classifies the permanent error codes.
- Bundle now also records `granted_scopes` and (already) `account_id`.

## 12. Catalogue as data - the `~/.abstract/models.json` overlay (plan 51 WP-D)

Model ids are **data, not code**. The next OpenAI rename (the `gpt-5.4` -> `gpt-5.6` migration in §10 shows they happen) must not need a broker edit. Since the ChatGPT-sign-in door has **no live model-listing route** the OAuth token can enumerate (§10 - the Responses backend exposes none the token is scoped for), the intended fix path for a new/renamed id is this config overlay, not a wire query. `lwd-openai-oauth.listModels()` reads it and overlays it over the built-in gpt-5.6 defaults; the file is re-read on every call, so editing it is picked up without a broker restart. There is no live-list branch to prefer because there is no live list; the async signature of `listModels()` is kept only so a future live source could slot in ahead of the overlay if OpenAI ever ships one.

**File:** `~/.abstract/models.json` (0600 in practice; the broker only reads it). **Shape:**

```json
{
  "openai-oauth": {
    "default": "gpt-5.6-terra",
    "models": [
      { "id": "gpt-5.6-sol",  "label": "Sol" },
      { "id": "gpt-5.7-nova", "label": "Nova" }
    ]
  }
}
```

**Merge semantics** (deliberately simple + predictable, all validated by `scripts/test/lwd-catalogue-fallback.test.js`):

- `openai-oauth.models` **replaces** the built-in list when present and non-empty, so an operator can drop a retired id or add a brand-new one (e.g. `gpt-5.7-nova`) with zero broker edits. Each entry needs a string `id`; a missing/blank `label` falls back to the id. A malformed entry is skipped, the rest kept.
- `openai-oauth.default` names which id is the sole `default:true`. If it names an id that IS in the effective list, that entry becomes the default; otherwise the effective list's own default (from the built-ins) or its first entry is kept - **never zero defaults**, so an absent/stale selection always resolves.
- A **bogus file degrades honestly**: unparseable JSON, a non-object, a wrong-typed `models`, an empty list, or a list with no usable entries all log **once** (`[lwd-oauth] ...; using the built-in model catalogue`) and fall back to the built-ins. It never crashes and never empties the picker. A file with no `openai-oauth` slice is silent (the common non-error case).

The overlay flows all the way through `/models` (the merged catalogue tags each entry's `backend`/`available`/`serving`), so the composer's picker shows the renamed/new id with no code change. The `LWD_OPENAI_MODEL` env override remains a second, lighter way to pin a single default slug.

**Note on the OpenRouter (included) door:** its single model id is a product-labelled "Included model" (the raw upstream id is intentionally not surfaced), driven by `OPENROUTER_MODEL`; it needs no config overlay because it is one founder-chosen model, not a user-facing catalogue.
