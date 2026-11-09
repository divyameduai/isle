#!/usr/bin/env python3
"""Explicit setup-time download. Never called by the offline chat runner."""
import json,pathlib,subprocess,sys,urllib.request
source=json.loads(pathlib.Path(__file__).with_name('model-source.json').read_text())
root=pathlib.Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
for item in source['files'] + source.get('assets', []):
    target=root/item['name']
    if not target.exists():
        prefix = 'asset_' if item in source.get('assets', []) else ''
        url=f"https://huggingface.co/{source[prefix+'repository']}/resolve/{source[prefix+'revision']}/{item['name']}"
        partial=target.with_suffix('.part')
        print(f"Downloading {item['name']}",flush=True)
        urllib.request.urlretrieve(url,partial)
        partial.rename(target)
subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('verify-model.py')),str(root)],check=True)
