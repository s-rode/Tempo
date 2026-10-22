"""Install a verified local bundle with a private backup and failure rollback."""
from pathlib import Path
import os
import plistlib
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
import uuid


def copy_bundle(source, target):
    subprocess.run(['ditto', str(source), str(target)], check=True)


def verify_bundle(bundle):
    with (bundle/'Contents/Info.plist').open('rb') as stream:
        if plistlib.load(stream).get('CFBundleIdentifier') != 'com.tempo.local':
            raise RuntimeError('Expected the com.tempo.local app bundle.')
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(bundle)], check=True)
    result = subprocess.run(['codesign', '-d', '-r-', str(bundle)], check=True, capture_output=True, text=True)
    requirement = 'designated => identifier "com.tempo.local"'
    if requirement not in (result.stdout + result.stderr).splitlines():
        raise RuntimeError('The bundle lacks the stable local designated requirement.')


def replace_app(source, destination, backup_root, verify=verify_bundle, copy=copy_bundle):
    """Prepare and verify all copies before moving the previous installed bundle."""
    verify(source)
    suffix = uuid.uuid4().hex
    stage = destination.parent/f'.Tempo-stage-{suffix}.app'
    holding = destination.parent/f'.Tempo-previous-{suffix}.app'
    backup = None
    moved_previous = installed_new = False
    try:
        if destination.exists():
            verify(destination)
            backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
            directory = Path(tempfile.mkdtemp(prefix='tempo-install-', dir=backup_root))
            backup = directory/'Tempo.app'
            copy(destination, backup)
            verify(backup)
        copy(source, stage)
        verify(stage)
        if destination.exists():
            destination.rename(holding)
            moved_previous = True
        stage.rename(destination)
        installed_new = True
        verify(destination)
    except BaseException:
        if installed_new and destination.exists():
            shutil.rmtree(destination)
        if moved_previous and holding.exists():
            holding.rename(destination)
        raise
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    if holding.exists():
        shutil.rmtree(holding)  # A separately verified private copy remains.
    return backup


def main():
    root = Path(__file__).resolve().parent.parent
    source = root/'dist-local/mac-arm64/Tempo.app'
    destination = Path('/Applications/Tempo.app')
    if destination.is_symlink():
        raise SystemExit('Refusing to replace a symbolic-link installation.')
    for process in ['Tempo', 'Tempo Notch Helper']:
        result = subprocess.run(['pgrep', '-x', process], capture_output=True)
        if result.returncode == 0:
            raise SystemExit('Quit Tempo and its helper after any active focus session ends. No installed files were changed.')
        if result.returncode != 1:
            raise SystemExit('Unable to verify that Tempo has quit. No installed files were changed.')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        opener.open('http://127.0.0.1:3001/health', timeout=1).close()
    except urllib.error.HTTPError:
        raise SystemExit('A local service still owns Tempo’s port. Stop it safely before installation.')
    except urllib.error.URLError:
        pass
    else:
        raise SystemExit('Quit Tempo and its local server before installation.')
    backup_root = Path(os.environ.get('TEMPO_APP_BACKUP_DIR', str(
        Path.home()/'Library/Application Support/Tempo Installer Backups'
    )))
    backup = replace_app(source, destination, backup_root)
    print('Installed and verified /Applications/Tempo.app.')
    if backup:
        print('Verified previous app bundle:', backup)
    print('Use the application-consistent database/support backup from the installation checkpoint for data recovery.')


if __name__ == '__main__':
    main()
