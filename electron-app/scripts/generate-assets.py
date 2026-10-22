"""Package the user-supplied Tempo icon and generate an original soft chime."""
from pathlib import Path
import subprocess, tempfile, wave, math, struct, shutil
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
sounds = root/'public/sounds'; sounds.mkdir(parents=True, exist_ok=True)
rate, duration = 44100, 0.65
with wave.open(str(sounds/'distraction.wav'), 'wb') as output:
    output.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    for index in range(int(rate*duration)):
        t = index/rate
        envelope = min(1, t/0.015) * math.exp(-7*t) * min(1, (duration-t)/0.04)
        value = 0.16 * envelope * (math.sin(2*math.pi*660*t) + 0.45*math.sin(2*math.pi*990*t))
        output.writeframesraw(struct.pack('<h', int(value*32767)))
print('Packaged the supplied Tempo icon and generated the chime.')
