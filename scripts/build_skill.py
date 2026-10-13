#!/usr/bin/env python3
"""Build a self-contained text edition and integrity manifest. No network."""
import argparse
import hashlib
import json
import posixpath
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / 'skills/remotion-best-practices'
OUT = ROOT / 'dist/remotion-best-practices-full.md'
MANIFEST = ROOT / 'dist/skill-manifest.json'

def anchor(path):
    return 'bundle-' + hashlib.sha256(path.encode()).hexdigest()[:16]

def build():
    camera_asset = SKILL / 'assets/continuous-camera.mjs'
    camera_example = ROOT / 'examples/pulse/src/camera.js'
    if camera_asset.exists() and camera_example.exists() and camera_asset.read_bytes() != camera_example.read_bytes():
        raise ValueError('Sync examples/pulse/src/camera.js with assets/continuous-camera.mjs first')
    files = sorted(p for p in SKILL.rglob('*') if p.is_file())
    paths = {p.relative_to(SKILL).as_posix() for p in files}
    records = {p.relative_to(SKILL).as_posix(): {
        'bytes': p.stat().st_size,
        'sha256': hashlib.sha256(p.read_bytes()).hexdigest()
    } for p in files}
    def relink(text, origin):
        def replace(match):
            label, target = match.groups()
            if ':' in target or target.startswith('#'): return match.group(0)
            path = target.split('#')[0]
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(origin), path))
            if resolved not in paths: return match.group(0)
            return f'[{label}](#{anchor(resolved)})'
        return re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', replace, text)
    main = relink((SKILL / 'SKILL.md').read_text(), 'SKILL.md')
    parts = [main, '\n# Full bundled resources\n\n',
        'This single-file edition includes every text resource below. Follow the linked resource '
        'sections instead of opening relative files. When a referenced script or SVG asset is '
        'needed as a file, materialize its fenced content at its recorded relative path. '
        'For normal installation, prefer the complete skill directory.\n\n']
    for p in files:
        rel = p.relative_to(SKILL).as_posix()
        if rel != 'SKILL.md': parts.append(f'- [{rel}](#{anchor(rel)})\n')
    for p in files:
        rel = p.relative_to(SKILL).as_posix()
        if rel == 'SKILL.md': continue
        body = p.read_text()
        parts.append(f'\n\n<a name="{anchor(rel)}"></a>\n\n# Resource: {rel}\n\n')
        if p.suffix == '.md':
            # Keep module metadata as data rather than additional skill frontmatter.
            metadata = re.match(r'^---\n(.*?)\n---\n', body, re.S)
            if metadata:
                parts.append('```yaml\n' + metadata.group(1) + '\n```\n\n')
                body = body[metadata.end():]
            parts.append(relink(body, rel))
        else:
            lang = {'.py': 'python', '.js': 'javascript', '.mjs': 'javascript', '.ts': 'typescript', '.tsx': 'tsx',
                    '.yaml': 'yaml', '.svg': 'xml'}.get(p.suffix, '')
            runs = [len(x) for x in re.findall(r'`+', body)]
            fence = '`' * max([3] + [x + 1 for x in runs])
            parts.append(f'{fence}{lang}\n{body}\n{fence}\n')
    text = ''.join(parts).rstrip() + '\n'
    manifest = json.dumps({'upstream': {'repo': 'remotion-dev/skills',
        'commit': '7ba4dcf8ebe1626b00baa41e1f2478113719b60b', 'version': '4.0.535'},
        'file_count': len(files), 'files': records,
        'single_file_sha256': hashlib.sha256(text.encode()).hexdigest()}, ensure_ascii=False, indent=2) + '\n'
    return text, manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    text, manifest = build()
    if args.check:
        if not OUT.exists() or not MANIFEST.exists() or OUT.read_text() != text or MANIFEST.read_text() != manifest:
            raise SystemExit('Bundle is stale. Run python scripts/build_skill.py')
        print('Full skill and manifest match all bundled resources.')
    else:
        OUT.parent.mkdir(exist_ok=True)
        OUT.write_text(text)
        MANIFEST.write_text(manifest)
        print(f'Built {OUT.relative_to(ROOT)} ({len(text.encode()):,} bytes).')
