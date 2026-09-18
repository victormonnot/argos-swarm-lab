# Official Linux amd64 SITL binary; no host autopilot installation is required.
FROM python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2
COPY requirements.txt /opt/sitl/requirements.txt
RUN python -m pip install --no-cache-dir --requirement /opt/sitl/requirements.txt
RUN python - <<'PY'
import hashlib
import pathlib
import platform
import urllib.request
if platform.machine() != 'x86_64':
    raise SystemExit('This pinned official SITL build supports Linux amd64 only.')
files = [
    ('https://firmware.ardupilot.org/Copter/stable-4.7.1/SITL_x86_64_linux_gnu/arducopter',
     '/opt/sitl/arducopter', '011627d41dd95640c3aca02d45283474be48721c8b1bb7a4b234d38b69063482'),
    ('https://raw.githubusercontent.com/ArduPilot/ardupilot/dbe792162d06cab66c3475fd5556bf7a120f119e/Tools/autotest/default_params/copter.parm',
     '/opt/sitl/copter.parm', '5e01345b45d1c6190b28bece5638bbdd4cf1cce35e05bbbf480ab24d2b51aa0e'),
]
for url, destination, expected in files:
    data = urllib.request.urlopen(url, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit(f'Checksum mismatch for {url}')
    pathlib.Path(destination).write_bytes(data)
pathlib.Path('/opt/sitl/arducopter').chmod(0o755)
PY
ENV MAVLINK20=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
