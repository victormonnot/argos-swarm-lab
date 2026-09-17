# Both middleware implementations run the same application in this image.
FROM ros:jazzy-ros-base@sha256:c3706ef0a0aa45413c07803cf433602f543b22e45b4855f6fca955c2d8ecc4e8
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends \
       ros-jazzy-rmw-zenoh-cpp=0.2.10-1noble.20260902.013525 \
       ros-jazzy-zenoh-cpp-vendor=0.2.10-1noble.20260722.215006 \
    && rm -rf /var/lib/apt/lists/*
