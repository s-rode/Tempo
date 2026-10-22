"""Inventory exact lockfile versions and their installed package notices."""
from pathlib import Path
import json, subprocess, hashlib
ROOT = Path(__file__).resolve().parent.parent
config = subprocess.check_output(['node', '-e', "const ts=require('typescript'),fs=require('fs');const r=ts.parseConfigFileTextToJson('bun.lock',fs.readFileSync('bun.lock','utf8'));if(r.error)process.exit(1);process.stdout.write(JSON.stringify(r.config));"], cwd=ROOT)
lock = json.loads(config)
required = {value[0] for value in lock['packages'].values() if isinstance(value, list) and '@' in value[0] and '@workspace:' not in value[0] and '@file:' not in value[0]}
found = {}
remote_path = ROOT/'docs/publication/optional-package-metadata.json'
remote = json.loads(remote_path.read_text()).get('packages', {}) if remote_path.exists() else {}
locked = {value[0]: value for value in lock['packages'].values() if isinstance(value, list)}

def collect(modules):
    if not modules.is_dir(): return
    for child in modules.iterdir():
        if child.name.startswith('.') or child.is_symlink(): continue
        packages = list(child.iterdir()) if child.name.startswith('@') and child.is_dir() else [child]
        for package in packages:
            manifest = package/'package.json'
            if not manifest.is_file(): continue
            try: metadata = json.loads(manifest.read_text())
            except (ValueError, UnicodeError): continue
            identity = metadata.get('name', '')+'@'+metadata.get('version', '')
            if identity in required:
                found[identity] = (metadata, package)
            else:
                for spec in required:
                    if spec.startswith(metadata.get('name', '') + '@github:'):
                        found[spec] = (metadata, package)
            collect(package/'node_modules')
collect(ROOT/'node_modules')
for workspace in lock.get('workspaces', {}):
    if workspace: collect(ROOT/workspace/'node_modules')
rows, notices = [], []
for identity in sorted(required):
    if identity not in found:
        metadata = remote.get(identity)
        integrity = locked[identity][-1]
        if metadata and isinstance(integrity, str) and integrity.startswith('sha512-') and metadata.get('dist_integrity') != integrity:
            raise ValueError('Registry integrity does not match the lockfile: '+identity)
        rows.append({'package':identity,'status':'registry_metadata_inspected_not_installed' if metadata else 'not_installed_for_this_platform','declared_license':metadata.get('license', 'UNKNOWN') if metadata else None, 'registry_metadata':metadata})
        continue
    metadata, package = found[identity]
    files = []
    for file in sorted(package.iterdir()):
        if file.is_file() and file.name.lower().startswith(('license', 'licence', 'copying', 'notice')):
            data = file.read_bytes()
            files.append({'name':file.name,'sha256':hashlib.sha256(data).hexdigest()})
            notices.append('\n\n## '+identity+' — '+file.name+'\n\n```text\n'+data.decode(errors='replace').rstrip()+'\n```')
    rows.append({'package':identity,'status':'installed_metadata_inspected','declared_license':metadata.get('license',metadata.get('licenses','UNKNOWN')),'notice_files':files})
(ROOT/'docs/publication/dependency-inventory.json').write_text(json.dumps({'lockfile_sha256':hashlib.sha256((ROOT/'bun.lock').read_bytes()).hexdigest(),'packages':rows},indent=2)+'\n')
(ROOT/'licenses/dependency-notices.md').write_text('# Locked dependency notices\n\nExtracted from the exact installed lockfile versions. Platform-specific optional packages not installed on this machine are listed separately in the inventory. Original package terms remain authoritative.\n'+''.join(notices)+'\n')
missing = sum(row['status'] == 'not_installed_for_this_platform' for row in rows)
unknown = sum(row['declared_license'] == 'UNKNOWN' for row in rows)
print(f'{len(rows)} locked versions; {len(found)} installed metadata records; {missing} platform/absent entries; {unknown} missing license declarations')
