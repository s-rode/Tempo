"""Refresh source hashes and explicitly record reviews without private recovery files."""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import subprocess
from collections import Counter

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('publication_check', ROOT/'scripts/publication-check.py')
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--record', action='append', default=[], metavar='PATH')
parser.add_argument('--disposition', choices=[
    'tempo_addition_reviewed', 'replacement_review_recorded',
    'reviewed_mit_adaptation', 'third_party_terms_recorded', 'publication_metadata_reviewed'
])
parser.add_argument('--note', help='Concrete evidence and review decision; not a legal clearance score.')
parser.add_argument('--source', help='Optional source/notice reference for attributed material.')
args = parser.parse_args()
if args.record and (not args.disposition or not args.note or not args.note.strip()):
    parser.error('--record requires --disposition and a substantive --note')

inventory_path = ROOT/'docs/publication/source-inventory.json'
reviews_path = ROOT/'docs/publication/reviewed-blobs.json'
inventory = json.loads(inventory_path.read_text())
reviews = json.loads(reviews_path.read_text())
previous = {row['path']: row for row in inventory['files']}
paths = subprocess.check_output([
    'git', '-C', str(ROOT), 'ls-files', '-c', '-o', '--exclude-standard', '-z'
]).split(b'\0')
current = sorted({raw.decode() for raw in paths if raw})
requested = set()
for name in args.record:
    path = Path(name)
    path = path if path.is_absolute() else ROOT/path
    try:
        relative = path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        parser.error('Review paths must be inside this repository.')
    if relative in checks.LEDGERS or relative not in current:
        parser.error('Review a discovered source file, not a review ledger or ignored path.')
    requested.add(relative)

rows = []
for name in current:
    if name in checks.LEDGERS:
        continue
    path = ROOT/name
    if not path.exists():
        continue  # A staged removal is omitted; historical reviews remain intact.
    if path.is_symlink() or not path.is_file():
        raise SystemExit(f'Unreviewed symbolic link or special file: {name}')
    data = path.read_bytes()
    issue = checks.content_issue(name, data)
    if issue:
        raise SystemExit(f'Cannot inventory {name}: {issue}')
    digest = hashlib.sha256(data).hexdigest()
    old = previous.get(name)
    row = dict(old) if old else {'path': name}
    if name in requested:
        review = {'disposition': args.disposition, 'review': args.note.strip()}
        if args.source:
            review['source_reference'] = args.source
        reviews['blobs'][digest] = review
        row.update(status=args.disposition, review_note=args.note.strip())
        if args.source:
            row['source_reference'] = args.source
    elif not old or old.get('sha256') != digest or old.get('status', '').endswith('review_required'):
        known = reviews['blobs'].get(digest)
        if known:
            row.update(status=known['disposition'], review_note=known['review'])
        else:
            row.update(status='change_review_required', review_note='New or changed content requires an explicit source review.')
            if old:
                row['previous_sha256'] = old.get('sha256')
    row['sha256'] = digest
    rows.append(row)

inventory['files'] = rows
inventory['counts'] = dict(Counter(row['status'] for row in rows))
inventory['publication_ready'] = False
inventory_path.write_text(json.dumps(inventory, indent=2)+'\n')
reviews_path.write_text(json.dumps(reviews, indent=2)+'\n')
pending = sum(row['status'].endswith('review_required') for row in rows)
print(f'Inventoried {len(rows)} source files; {len(requested)} explicit reviews; {pending} pending.')
print('Source/history checks and runtime acceptance remain separate publication gates.')
