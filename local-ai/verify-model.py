#!/usr/bin/env python3
"""Check pinned model weights and supporting files before installation."""
import hashlib, json, pathlib, sys
source=json.loads(pathlib.Path(__file__).with_name('model-source.json').read_text())
root=pathlib.Path(sys.argv[1])
for entry in source['files'] + source.get('assets', []):
    path=root/entry['name']
    if path.stat().st_size != entry['size']:
        raise SystemExit(f"Incorrect file size: {path.name}")
    with path.open('rb') as stream:
        digest=hashlib.file_digest(stream,'sha256').hexdigest()
    if digest != entry['sha256']:
        raise SystemExit(f"Checksum mismatch: {path.name}")
    print(f"Verified {path.name}", flush=True)
