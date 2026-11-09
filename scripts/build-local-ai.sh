#!/usr/bin/env bash
set -euo pipefail
isle_source="$(cd "$(dirname "$0")/.." && pwd)"
isle_engine="$(dirname "$isle_source")/mistral-rs"
isle_revision=fb4cdc3730dc64b366724e7637a205a8b7747499
if [ ! -d "$isle_engine/.git" ]; then
    git clone https://github.com/EricLBuehler/mistral.rs.git "$isle_engine"
    git -C "$isle_engine" checkout --detach "$isle_revision"
fi
[ "$(git -C "$isle_engine" rev-parse HEAD)" = "$isle_revision" ] || {
    echo "Expected mistral.rs revision $isle_revision at $isle_engine" >&2; exit 1;
}
cargo build --locked --release --manifest-path "$isle_source/local-ai/Cargo.toml" -j 2
