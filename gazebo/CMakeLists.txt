cmake_minimum_required(VERSION 3.16)
project(argos_gazebo_bridge)
set(CMAKE_CXX_STANDARD 17)
find_package(gz-sim8 REQUIRED)
add_library(ArduPilotPlugin SHARED
  /opt/ardupilot_gazebo/src/ArduPilotPlugin.cc
  /opt/ardupilot_gazebo/src/SocketUDP.cc
  /opt/ardupilot_gazebo/src/Util.cc)
target_include_directories(ArduPilotPlugin PRIVATE /opt/ardupilot_gazebo/include)
target_link_libraries(ArduPilotPlugin PRIVATE gz-sim8::gz-sim8)
add_library(TruthObserver SHARED /opt/argos-build/TruthObserver.cc)
target_link_libraries(TruthObserver PRIVATE gz-sim8::gz-sim8)
