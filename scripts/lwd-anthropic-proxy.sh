#!/usr/bin/env bash

# Compatibility wrapper. The model broker was renamed to a backend-neutral name in issue #170
# (Anthropic was removed in plan 35). This thin shim keeps the old path working - it just execs
# the real launcher, forwarding every argument. New callers should use lwd-model-broker.sh directly.

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	DIR=$(dirname $(realpath "$0"))
else
	DIR=$(dirname $(readlink -f $0))
fi

exec "$DIR/lwd-model-broker.sh" "$@"
