# The wrapper builds workshop 19 first and verifies its image identity.
ARG GAZEBO_IMAGE=argos-ardupilot-gazebo:4.7.1-harmonic
FROM ${GAZEBO_IMAGE}
COPY CMakeLists.txt SharedWorldObserver.cc /opt/argos-shared-world/
RUN cmake -S /opt/argos-shared-world -B /opt/argos-shared-world/build -DCMAKE_BUILD_TYPE=Release && cmake --build /opt/argos-shared-world/build -j2
ENV GZ_SIM_SYSTEM_PLUGIN_PATH=/opt/argos-shared-world/build:/opt/argos-build/build
