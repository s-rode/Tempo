"""Package the user-supplied Tempo icon."""
from pathlib import Path
import subprocess, tempfile, shutil
root = Path(__file__).resolve().parent.parent
(root/'build').mkdir(exist_ok=True)
(root/'resources').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='tempo-assets-') as scratch:
    folder = Path(scratch)
    png = folder/'source.png'
    shutil.copyfile(root/'assets/tempo-icon.png', png)
    icons = folder/'Tempo.iconset'; icons.mkdir()
    for size in [16, 32, 128, 256, 512]:
        for scale in [1, 2]:
            name = 'icon_%dx%d%s.png' % (size, size, '@2x' if scale == 2 else '')
            subprocess.run(['sips', '-z', str(size*scale), str(size*scale), str(png), '--out', str(icons/name)], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['iconutil', '-c', 'icns', str(icons), '-o', str(root/'build/icon.icns')], check=True)
    for dest in [root/'build/icon.png', root/'resources/icon.png']: shutil.copyfile(png, dest)
print('Packaged the supplied Tempo icon.')
