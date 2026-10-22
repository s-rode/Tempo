"""Check source and reachable Git history without private preparation ledgers.

These checks catch specific file and credential patterns; they do not prove
license coverage or the absence of every possible secret.
"""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
EXCLUDED = ('client/', 'node_modules/', '.publication-backups/', '.publication-work/')
BINARY_SUFFIXES = (
    '.node', '.dmg', '.xpi', '.zip', '.icns', '.tsbuildinfo', '.bundle',
    '.pyc', '.o', '.a', '.so', '.dylib', '.exe', '.wav', '.mp3',
)


def git(*arguments):
    return subprocess.check_output(['git', '-C', str(ROOT), *arguments])


def content_issue(path, data):
    parts = Path(path).parts
    if path.startswith(EXCLUDED) or 'node_modules' in parts:
        return 'excluded or private path'
    if any(part.endswith('.app') for part in parts) or path.endswith(BINARY_SUFFIXES):
        return 'generated binary or backup'
    if (Path(path).name.startswith('.env') or path.endswith('.env')) and not path.endswith('.example'):
        return 'private environment file'
    if b'\0' in data or path.endswith('.png'):
        return None
    text = data.decode('utf-8', errors='replace')
    if re.search(r'(?:sk-[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)', text):
        return 'credential-shaped content'
    if ('/Users/' + 'samuel/') in text:
        return 'private absolute filesystem path'
    return None


def self_test():
    for path in ['client/file.ts', 'server/.env', 'server/local.env',
                 'app.dmg', 'dist/Tempo.app/Contents/MacOS/Tempo', 'cached.pyc']:
        assert content_issue(path, b'')
    assert content_issue('file.ts', ('sk-' + 'A' * 40).encode())
    assert content_issue('file.ts', ('/Users/' + 'samuel/private').encode())
    assert content_issue('.env.local.example', b'KEY=replace-me') is None
    assert content_issue('file.ts', b'export const example = true') is None


def main():
    self_test()
    errors = set()

    def inspect(path, data):
        issue = content_issue(path, data)
        if issue:
            errors.add(f'{path}: {issue}')

    paths = git('ls-files', '-c', '-o', '--exclude-standard', '-z').split(b'\0')
    for raw in set(paths):
        if not raw:
            continue
        path = raw.decode()
        file = ROOT / path
        if file.is_symlink():
            errors.add(f'{path}: unreviewed symbolic link')
        elif file.is_file():
            inspect(path, file.read_bytes())
        elif file.exists():
            errors.add(f'{path}: unsupported file type')
        # Tracked removals are still checked in their historical revisions.

    seen = set()
    commits = git('rev-list', '--all').decode().splitlines()
    for commit in commits:
        inspect('commit-message.txt', git('show', '-s', '--format=%B', commit))
        for entry in git('ls-tree', '-r', '-z', commit).split(b'\0'):
            if not entry:
                continue
            metadata, raw_path = entry.split(b'\t', 1)
            mode, kind, oid = metadata.decode().split()
            path = raw_path.decode()
            if mode == '120000' or kind != 'blob':
                errors.add(f'{path}: symbolic link or submodule')
                continue
            key = (oid, path)
            if key not in seen:
                seen.add(key)
                inspect(path, git('cat-file', 'blob', oid))
    if errors:
        print('\n'.join(sorted(errors)))
        return 1
    print(f'PASS: current source and {len(commits)} reachable commits checked for excluded files and credential patterns')
    return 0


if __name__ == '__main__':
    sys.exit(main())
