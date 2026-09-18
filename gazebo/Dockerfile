# Gazebo Harmonic runs headlessly; ArduPilot's official JSON plugin needs no ROS.
FROM ubuntu:22.04@sha256:b8b6ee6aa931ecd9d0d952abc34dc0e5f7c6a30c6bb71b079fe399fde0329c02
ENV DEBIAN_FRONTEND=noninteractive GZ_VERSION=harmonic GZ_IP=127.0.0.1 MAVLINK20=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg python3 python3-pip cmake g++ make pkg-config && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://packages.osrfoundation.org/gazebo.gpg -o /usr/share/keyrings/pkgs-osrf-archive-keyring.gpg && echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/pkgs-osrf-archive-keyring.gpg] https://packages.osrfoundation.org/gazebo/ubuntu-stable jammy main' > /etc/apt/sources.list.d/gazebo-stable.list
RUN apt-get update && apt-get install -y --no-install-recommends gz-sim8-cli=8.15.0-1~jammy libgz-sim8-dev=8.15.0-1~jammy libgz-sim8-plugins=8.15.0-1~jammy rapidjson-dev=1.1.0+dfsg2-7 python3-gz-transport13=13.6.0-1~jammy python3-gz-msgs10=10.4.0-1~jammy && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --no-cache-dir pymavlink==2.4.49 lxml==6.1.3 fastcrc==0.5.0
RUN python3 - <<'PY'
import urllib.request,hashlib,pathlib,tarfile
files=[
('https://codeload.github.com/ArduPilot/ardupilot_gazebo/tar.gz/082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5','/opt/plugin.tar.gz','8f4e00258e6f5f354e5a3adca61513e93fc0c98b66e1d9ee7611550afc7a6188'),
('https://firmware.ardupilot.org/Copter/stable-4.7.1/SITL_x86_64_linux_gnu/arducopter','/opt/arducopter','011627d41dd95640c3aca02d45283474be48721c8b1bb7a4b234d38b69063482'),
('https://raw.githubusercontent.com/ArduPilot/ardupilot/dbe792162d06cab66c3475fd5556bf7a120f119e/Tools/autotest/default_params/copter.parm','/opt/copter.parm','5e01345b45d1c6190b28bece5638bbdd4cf1cce35e05bbbf480ab24d2b51aa0e'),
('https://raw.githubusercontent.com/ArduPilot/ardupilot/dbe792162d06cab66c3475fd5556bf7a120f119e/Tools/autotest/default_params/gazebo-iris.parm','/opt/gazebo-iris.parm','4aee140cbb29b967e4519e4c84c4b389a2172c30e542f36b4fba4c118b4d4750')]
for url,path,expected in files:
 data=urllib.request.urlopen(url,timeout=90).read()
 if hashlib.sha256(data).hexdigest()!=expected: raise RuntimeError('Download checksum mismatch: '+url)
 pathlib.Path(path).write_bytes(data)
with tarfile.open('/opt/plugin.tar.gz') as archive: archive.extractall('/opt')
pathlib.Path('/opt/ardupilot_gazebo-082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5').rename('/opt/ardupilot_gazebo')
pathlib.Path('/opt/arducopter').chmod(0o755)
PY
# Build only the upstream vehicle bridge, avoiding unused camera/GUI dependencies.
COPY CMakeLists.txt TruthObserver.cc /opt/argos-build/
RUN cmake -S /opt/argos-build -B /opt/argos-build/build -DCMAKE_BUILD_TYPE=Release && cmake --build /opt/argos-build/build -j2
ENV GZ_SIM_SYSTEM_PLUGIN_PATH=/opt/argos-build/build GZ_SIM_RESOURCE_PATH=/opt/ardupilot_gazebo/models
