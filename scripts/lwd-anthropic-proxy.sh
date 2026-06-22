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

exec node "$ROOT/scripts/lwd-anthropic-proxy.js" "$@"
