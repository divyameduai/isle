#!/usr/bin/env bash
# Install the already-built local assistant alongside the existing Isle daemon.
set -euo pipefail
isle_source="$(cd "$(dirname "$0")/.." && pwd)"
isle_models="${1:?Pass the directory containing the verified model files}"
isle_data="${XDG_DATA_HOME:-$HOME/.local/share}"
isle_dest="$isle_data/gnome-shell/extensions/isle@zickrian.github.io"
isle_runtime="$isle_data/isle-local"
isle_binary="$isle_source/local-ai/target/release/isle-local-ai"
[ -d "$isle_dest" ] || { echo 'Install Isle before this integration.' >&2; exit 1; }
[ -x "$isle_binary" ] || { echo 'Build local-ai first.' >&2; exit 1; }
"$isle_binary" --check-privacy
python3 "$isle_source/local-ai/verify-model.py" "$isle_models"
mkdir -p "$isle_runtime/bin" "$isle_runtime/models" "$isle_runtime/backups"
isle_backup="$isle_runtime/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$isle_backup"
cp -a "$isle_dest" "$isle_backup/extension"
install -m755 "$isle_binary" "$isle_runtime/bin/isle-local-ai"
python3 - "$isle_source/local-ai/model-source.json" "$isle_models" "$isle_runtime/models" <<'PYMODEL'
import json,pathlib,shutil,sys
source=json.loads(pathlib.Path(sys.argv[1]).read_text())
for entry in source['files']+source.get('assets',[]):
    shutil.copy2(pathlib.Path(sys.argv[2])/entry['name'],pathlib.Path(sys.argv[3])/entry['name'])
PYMODEL
cp "$isle_source/local-ai/model-source.json" "$isle_runtime/models/source.json"
# Stage a complete copy so an interrupted installation leaves the old extension intact.
isle_stage="$(mktemp -d "$isle_runtime/extension.XXXXXX")"
cp -a "$isle_source/gnome-extension/." "$isle_stage/"
mkdir -p "$isle_stage/local-ai"
install -m755 "$isle_source/local-ai/run" "$isle_stage/local-ai/run"
glib-compile-schemas --strict "$isle_stage/schemas"
mv "$isle_dest" "$isle_backup/replaced-extension"
if ! mv "$isle_stage" "$isle_dest"; then
    mv "$isle_backup/replaced-extension" "$isle_dest"
    echo 'Installation failed; restored the prior extension.' >&2
    exit 1
fi
printf 'Installed. Sign out and sign back in, then press Ctrl+Alt+I.\nBackup: %s\n' "$isle_backup/extension"
