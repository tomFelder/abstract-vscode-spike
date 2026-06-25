#!/usr/bin/env bash

# Start the Living Documents Anthropic OAuth proxy (see scripts/lwd-anthropic-proxy.js).
# Requires Node 24 and a completed `ant auth login`. Binds 127.0.0.1:8090 by default
# (override with LWD_PROXY_PORT). The renderer reaches it via livingDocs.modelProxyUrl.

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

# v6 (plan 14, decision 44): OpenRouter is the default model backend for every call — the Anthropic
# Console org is out of credits, so the OAuth path 400s on billing. Default the backend + key file here
# (override by exporting LWD_BACKEND / OPENROUTER_API_KEY_FILE before running). The renderer is unchanged:
# it always talks to this proxy's /v1/messages in the Anthropic Messages shape; the proxy translates.
export LWD_BACKEND="${LWD_BACKEND:-openrouter}"
if [ "$LWD_BACKEND" = "openrouter" ] && [ -z "$OPENROUTER_API_KEY" ] && [ -z "$OPENROUTER_API_KEY_FILE" ] && [ -f "$HOME/.config/lwd-openrouter.key" ]; then
	export OPENROUTER_API_KEY_FILE="$HOME/.config/lwd-openrouter.key"
fi

exec node "$ROOT/scripts/lwd-anthropic-proxy.js" "$@"
