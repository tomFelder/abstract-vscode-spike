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

# Backend defaults to the founder-funded OpenRouter fallback tier (plan 35 iter 1). It is metered per user
# to a small daily budget (LWD_DAILY_BUDGET_USD, default US$1) that pauses gracefully at the cap (iter 3).
# Set LWD_BACKEND=openai-oauth for the "Sign in with ChatGPT" subscription path (plan 35 iter 2): the user
# signs in from Abstract Settings, their model calls draw on their own ChatGPT plan (not metered), and the
# token bundle lives only here in ~/.abstract/openai-oauth.json (0600) - never in the renderer.
# Override LWD_BACKEND / OPENROUTER_API_KEY_FILE / OPENROUTER_MODEL / LWD_DAILY_BUDGET_USD before running.
# The renderer is unchanged: it always talks to this broker's /v1/messages in the Messages shape;
# the broker translates. With no backend configured the app runs on its built-in heuristic fallback (demoable
# with zero backends).
export LWD_BACKEND="${LWD_BACKEND:-openrouter}"
if [ "$LWD_BACKEND" = "openrouter" ] && [ -z "$OPENROUTER_API_KEY" ] && [ -z "$OPENROUTER_API_KEY_FILE" ] && [ -f "$HOME/.config/lwd-openrouter.key" ]; then
	export OPENROUTER_API_KEY_FILE="$HOME/.config/lwd-openrouter.key"
fi

exec node "$ROOT/scripts/lwd-model-broker.js" "$@"
