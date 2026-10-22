"""Fail closed on pending provenance/history review; inspect every reachable revision."""
from pathlib import Path
import hashlib, json, re, subprocess, sys

ROOT = Path(__file__).resolve().parent.parent
FORBIDDEN_PATHS = ('client/', 'node_modules/', '.publication-backups/', '.publication-work/')
ORIGINAL_ROOT = '8b93cda'
SOURCE_HISTORY_COUNT = 128
SOURCE_HISTORY_SHA256 = 'e2cfdad8073b35cb583254b25eb84ad3d5d72fcb9f10aebc689dbd7d430f149b'
# These ledgers contain their own review results and therefore cannot require a
# hash entry for themselves. Their JSON schemas and content are still checked.
LEDGERS = {
    'docs/publication/source-inventory.json',
    'docs/publication/history-map.json',
    'docs/publication/reviewed-blobs.json',
}

def git(*arguments):
    return subprocess.check_output(['git', '-C', str(ROOT), *arguments], stderr=subprocess.DEVNULL)

def content_issue(path, data):
    if path.startswith(FORBIDDEN_PATHS) or any(part == 'node_modules' for part in Path(path).parts):
        return 'private or excluded path'
    if any(part.endswith('.app') for part in Path(path).parts):
        return 'generated application bundle'
    if path.endswith(('.node', '.dmg', '.xpi', '.zip', '.icns', '.tsbuildinfo', '.bundle', '.pyc', '.o', '.a', '.so', '.dylib', '.exe', '.wav', '.mp3')):
        return 'generated binary or private backup'
    if Path(path).name.startswith('.env') and not path.endswith('.example'):
        return 'private environment file'
    if b'\0' in data or path.endswith('.png'): return None
    text = data.decode('utf-8', errors='replace')
    if re.search(r'(?:sk-[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)', text):
        return 'credential-shaped content'
    if ('/Users/' + 'samuel/') in text or ('/Users/' + 'samuel/Privat') in text:
        return 'private absolute filesystem path'
    return None

def main():
    errors = []
    inventory_path = ROOT/'docs/publication/source-inventory.json'
    history_path = ROOT/'docs/publication/history-map.json'
    reviews_path = ROOT/'docs/publication/reviewed-blobs.json'
    inventory = json.loads(inventory_path.read_text())
    pending = [row['path'] for row in inventory['files'] if row['status'].endswith('review_required')]
    if pending: errors.append(f'{len(pending)} current source entries still require provenance review')
    history = json.loads(history_path.read_text())
    if history.get('status') != 'complete': errors.append('historical replay/review is incomplete')
    original_ids = [row['original_commit'] for row in history['commits']]
    fingerprint = hashlib.sha256('\n'.join(sorted(original_ids)).encode()).hexdigest()
    if len(set(original_ids)) != SOURCE_HISTORY_COUNT or fingerprint != SOURCE_HISTORY_SHA256:
        errors.append('original-to-public mapping does not cover the checkpoint history')
    for row in history['commits']:
        if row['disposition'] == 'pending_review':
            errors.append('original commit dispositions are incomplete'); break
    approved = json.loads(reviews_path.read_text()).get('blobs', {}) if reviews_path.exists() else {}
    for digest, review in approved.items():
        if not re.fullmatch(r'[a-f0-9]{64}', digest) or not review.get('disposition') or not review.get('review'):
            errors.append('a blob review record is malformed')
    current = {
        path.decode() for path in git('ls-files', '-c', '-o', '--exclude-standard', '-z').split(b'\0')
        if path
    }
    indexed = {row['path']: row for row in inventory['files']}
    for path in sorted(current):
        file = ROOT/path
        if not file.is_file() or file.is_symlink():
            errors.append(f'{path}: missing file or unreviewed symbolic link')
            continue
        data = file.read_bytes()
        issue = content_issue(path, data)
        if issue: errors.append(f'{path}: {issue}')
        if path in LEDGERS: continue
        digest = hashlib.sha256(data).hexdigest()
        if path not in indexed or indexed[path]['sha256'] != digest:
            errors.append(f'{path}: current inventory entry is missing or stale')
        if digest not in approved:
            errors.append(f'{path}: current content has no completed review record')
    if set(indexed) - current:
        errors.append('source inventory contains removed paths')
    for ref in git('for-each-ref', '--format=%(refname)').decode().splitlines():
        if not ref.startswith(('refs/heads/', 'refs/tags/', 'refs/remotes/')):
            errors.append('non-public or backup refs remain in the publication repository')
    try:
        commits = git('rev-list', '--all').decode().splitlines()
    except subprocess.CalledProcessError:
        commits = []
    if not commits: errors.append('no reviewed publication history has been constructed')
    reachable = set(commits)
    for row in history['commits']:
        if row.get('public_commit') not in reachable:
            errors.append('an original-to-public mapping points outside reachable history')
        if not row.get('reason', '').strip():
            errors.append('an original-to-public mapping lacks its curation reason')
    for commit in commits:
        if commit.startswith(ORIGINAL_ROOT): errors.append('original recovery ancestry was imported')
        identity = git('show', '-s', '--format=%an%x00%ae', commit).decode().strip().split('\0')
        if identity[0] == 'Samuel R' and identity[1] != '47924596+s-rode@users.noreply.github.com':
            errors.append('a public Samuel commit has the wrong author email')
        message = git('show', '-s', '--format=%B', commit)
        issue = content_issue('commit-message.txt', message)
        if issue: errors.append(f'a commit message contains {issue}')
    seen = set(); unreviewed = set()
    for commit in commits:
        for entry in git('ls-tree', '-r', '-z', commit).split(b'\0'):
            if not entry: continue
            metadata, path_bytes = entry.split(b'\t', 1)
            mode, kind, oid = metadata.decode().split()
            path = path_bytes.decode()
            if kind != 'blob':
                errors.append('unreviewed submodule/tree entry'); continue
            key = (oid, path)
            if key in seen: continue
            seen.add(key)
            data = git('cat-file', 'blob', oid)
            issue = content_issue(path, data)
            if issue: errors.append(f'{path}: {issue}')
            sha256 = hashlib.sha256(data).hexdigest()
            if path in LEDGERS:
                try:
                    ledger = json.loads(data)
                    field = 'files' if path.endswith('source-inventory.json') else 'commits' if path.endswith('history-map.json') else 'blobs'
                    if not isinstance(ledger, dict) or not isinstance(ledger.get(field), (list, dict)):
                        raise ValueError()
                except (ValueError, TypeError):
                    errors.append(f'{path}: invalid historical review ledger')
            elif sha256 not in approved: unreviewed.add(oid)
    if unreviewed: errors.append(f'{len(unreviewed)} historical blobs have no completed review record')
    if errors:
        print('PUBLICATION BLOCKED:')
        for error in sorted(set(errors))[:30]: print('- '+error)
        return 1
    print(f'PASS: {len(commits)} reachable commits and {len(seen)} historical path/blob pairs reviewed')
    return 0

if __name__ == '__main__':
    if '--self-test' in sys.argv:
        assert content_issue('client/file.ts', b'')
        assert content_issue('server/.env', b'')
        assert content_issue('public/app.dmg', b'')
        assert content_issue('dist/Tempo.app/Contents/MacOS/Tempo', b'')
        assert content_issue('scripts/__pycache__/cached.pyc', b'')
        assert content_issue('file.ts', ('sk-'+'A'*40).encode())
        assert content_issue('file.ts', ('/Users/'+'samuel/private').encode())
        assert content_issue('server/.env.local.example', b'AUTH_SECRET=replace-with-a-random-local-secret') is None
        assert content_issue('file.ts', b'export const example = true') is None
        print('Publication exclusion checks passed')
    else:
        sys.exit(main())
