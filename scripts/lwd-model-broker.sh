#!/usr/bin/env bash

# Start the Living Documents model broker (see scripts/lwd-model-broker.js).
# The app starts this automatically (issue #169); this script is for running it by hand.
# Requires Node 24. Binds 127.0.0.1:8090 by default (override with LWD_PROXY_PORT).
# The renderer reaches it via livingDocs.modelProxyUrl. The broker authenticates against a
# pluggable backend (plan 35): the founder-funded OpenRouter fallback now, the user's own
# ChatGPT subscription via OpenAI OAuth next. No credential ever reaches the renderer.

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
fi

# Use the repo's pinned Node 24 if nvm is available (the global fetch + server need it).
if [ -s "$HOME/.nvm/nvm.sh" ]; then
	export NVM_DIR="$HOME/.nvm"
	. "$NVM_DIR/nvm.sh"
	nvm use 24.15.0 >/dev/null 2>&1 || true
fi

# LWD_BACKEND IS DELIBERATELY LEFT UNSET (plan 55 WP-B3). This line used to read
#
#     export LWD_BACKEND="${LWD_BACKEND:-openrouter}"
#
# which put every hand-started broker into FORCED mode - the dev override that pins one door. That was
# harmless while the door was chosen before the model, and is not harmless now: forced mode is the one path
# that does NOT let a named model choose its own door, so every founder smoke and every docs/qa session run
# through this script was silently exercising the pre-B3 routing while the app was exercising the new one.
# Unset, the broker runs in DYNAMIC mode (its real default): it prefers a servable ChatGPT bundle, falls back
# to the included tier, and honours per-request model pinning. Set LWD_BACKEND explicitly to force one door
# for a deliberate experiment - which is what the override was always for.
#
# The included tier (the `openrouter` door) is the founder-funded fallback (plan 35 iter 1), metered per user
# to a small daily budget (LWD_DAILY_BUDGET_USD, default US$1) that pauses gracefully at the cap (iter 3).
# The "Sign in with ChatGPT" subscription path (plan 35 iter 2) needs no env var at all: the user signs in
# from Abstract Settings, their model calls draw on their own ChatGPT plan (not metered), and the token bundle
# lives only here in ~/.abstract/openai-oauth.json (0600) - never in the renderer.
# Override LWD_BACKEND / OPENROUTER_API_KEY_FILE / OPENROUTER_MODEL / LWD_DAILY_BUDGET_USD before running.
# The renderer is unchanged: it always talks to this broker's /v1/messages in the Messages shape;
# the broker translates. With no backend configured the app runs on its built-in heuristic fallback (demoable
# with zero backends).
if [ "${LWD_BACKEND:-openrouter}" = "openrouter" ] && [ -z "$OPENROUTER_API_KEY" ] && [ -z "$OPENROUTER_API_KEY_FILE" ] && [ -f "$HOME/.config/lwd-openrouter.key" ]; then
	export OPENROUTER_API_KEY_FILE="$HOME/.config/lwd-openrouter.key"
fi

exec node "$ROOT/scripts/lwd-model-broker.js" "$@"
