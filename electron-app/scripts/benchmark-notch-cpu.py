"""Compare live timer CPU without changing Tempo's saved settings (macOS only).

Usage: python3 scripts/benchmark-notch-cpu.py '/path/to/Tempo Notch Helper' [static]
Run once with animations and once with `static`, leaving the pointer away from
the notch. Quit the normal Tempo instance first so it cannot cover the fixture.
Requires a desktop session. Reports process CPU, not battery energy.
"""

import ctypes
import json
import subprocess
import sys
import time

# PROC_PIDTASKINFO CPU times are Mach absolute time units on Apple silicon.
class TaskInfo(ctypes.Structure):
    _fields_ = [('virtual_size',ctypes.c_uint64), ('resident_size',ctypes.c_uint64),
        ('total_user',ctypes.c_uint64), ('total_system',ctypes.c_uint64),
        ('threads_user',ctypes.c_uint64), ('threads_system',ctypes.c_uint64),
        ('rest',ctypes.c_int32 * 12)]
libproc = ctypes.CDLL('/usr/lib/libproc.dylib')
libproc.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
class Timebase(ctypes.Structure):
    _fields_ = [('numer',ctypes.c_uint32), ('denom',ctypes.c_uint32)]
timebase = Timebase()
ctypes.CDLL('/usr/lib/libSystem.B.dylib').mach_timebase_info(ctypes.byref(timebase))
scale = timebase.numer / timebase.denom
def cpu_seconds(pid):
    info = TaskInfo()
    size = libproc.proc_pidinfo(pid, 4, 0, ctypes.byref(info), ctypes.sizeof(info))
    if size != ctypes.sizeof(info):
        raise RuntimeError('Cannot inspect benchmark child')
    return (info.total_user + info.total_system) * scale / 1e9

if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != 'static'):
    raise SystemExit(__doc__)

helper = subprocess.Popen([sys.argv[1]], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, text=True)
try:
    while True:
        line = helper.stdout.readline()
        if not line:
            raise RuntimeError('Helper exited before becoming ready')
        if json.loads(line).get('type') == 'ready':
            break
    now = time.time() * 1000
    running = dict(accumulatedMs=42000, runningSinceMs=now)
    frozen = dict(accumulatedMs=12000, runningSinceMs=None)
    payload = dict(latestStatus='productive', dailyProductiveMs=42000, dailyUnproductiveMs=12000,
        dailyProductiveClock=running, dailyUnproductiveClock=frozen, productiveClock=running,
        distractedClock=frozen, runtimeMode='normal', trackingState='normal', suspensionReasons=[],
        animateTimerDigits=len(sys.argv) < 3 or sys.argv[2] != 'static', availableCategories=[], eventIds=[])
    helper.stdin.write(json.dumps(dict(version=5,type='status',payload=payload))+'\n')
    helper.stdin.flush()
    time.sleep(2)
    start_cpu = cpu_seconds(helper.pid)
    start = time.monotonic()
    time.sleep(10)
    elapsed = time.monotonic() - start
    cpu = cpu_seconds(helper.pid) - start_cpu
    print(json.dumps(dict(helper=sys.argv[1], scenario='collapsed live timer; stationary mouse', animated=payload['animateTimerDigits'], seconds=round(elapsed,2), cpu_seconds=round(cpu,4), average_cpu_percent=round(cpu / elapsed * 100,2))))
finally:
    if helper.poll() is None:
        try:
            helper.stdin.write(json.dumps(dict(version=5, type='shutdown'))+'\n')
            helper.stdin.flush()
            helper.wait(timeout=5)
        except (BrokenPipeError, subprocess.TimeoutExpired):
            helper.kill()
            helper.wait()
