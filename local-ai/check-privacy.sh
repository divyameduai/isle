#!/bin/sh
set -eu
isle_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$isle_root/target/release/isle-local-ai" --check-privacy
