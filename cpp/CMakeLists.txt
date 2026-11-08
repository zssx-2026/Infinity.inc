# Infinity.Inc - the C++ build.
#
# One static core, one executable per application, and then the naming layer
# that turns each executable into the eight names the suite ships under.
#
# Everything is linked statically. That is the whole reason for the port: an
# executable that needs no runtime, no DLL and no installer to run, so a copy
# on a USB stick works on a machine that has never seen this software. The
# MinGW runtime and libstdc++ are folded into the binary for the same reason.
#
# Windows-only, deliberately. The system HTTP stack, the console and the
# window are all Win32; carrying three platform backends before the first one
# works would be weight without value.

cmake_minimum_required(VERSION 3.20)
project(InfinityInc CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT WIN32)
  message(FATAL_ERROR "Infinity.Inc is built for Windows; the Win32 API is used directly.")
endif()

# The product icon and the VERSIONINFO block are resources, and resources are
# compiled by windres rather than by the C++ compiler. Naming RC as a language
# here is what makes CMake route a .rc source to the resource compiler and link
# the object it produces.
enable_language(RC)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_compile_options(-Wall -Wextra -Wno-unused-parameter)

# Static everything, and strip what is left. -s drops the symbol table, which
# on a MinGW build is most of the file.
add_link_options(-static -static-libgcc -static-libstdc++ -s)

# ---------------------------------------------------------------- core

file(GLOB CORE_SRC CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/core/src/*.cpp)

add_library(inc_core STATIC ${CORE_SRC})
target_include_directories(inc_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/core/include)
target_link_libraries(inc_core PUBLIC winhttp bcrypt shell32 comctl32 ws2_32)

# ---------------------------------------------------------------- common

# "The file unblocks itself" lives here, once. Every application links it and
# the NSIS installers clear the same stream on the files they drop, so the
# behaviour is defined in one place instead of six.
add_library(inc_common STATIC ${CMAKE_CURRENT_SOURCE_DIR}/common/unblock.cpp)
target_include_directories(inc_common PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/common)

# ---------------------------------------------------------------- resources

# One resource script per application carries the product icon (an icon group
# plus the icons it names) and the VERSIONINFO strings Explorer shows.
# tools/build.mjs writes <app>.rc into this build directory before configuring,
# because the icon file and the version already live outside CMake; the build
# here only has to hand the file to windres and link the object. The file is
# added when it exists so a hand-run configure still works, and build.mjs fails
# the build afterwards if an executable came out without a resource directory.
set(INC_RC_DIR ${CMAKE_CURRENT_BINARY_DIR}/rc)

# ---------------------------------------------------------------- apps

# Each application produces ONE executable. Its names are copies of it,
# made after the build by tools/build.mjs, exactly as the Node build hard
# linked them - the program reads its own file name to know which face to be.
set(INC_APPS inc ipm)

foreach(app ${INC_APPS})
  if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/apps/${app}/main.cpp)
    set(INC_RC_SRC ${INC_RC_DIR}/${app}.rc)
    if(EXISTS ${INC_RC_SRC})
      add_executable(${app} apps/${app}/main.cpp ${INC_RC_SRC})
    else()
      message(WARNING "${app}: ${INC_RC_SRC} is missing, so the icon and VERSIONINFO resource are not built in; run tools/build.mjs")
      add_executable(${app} apps/${app}/main.cpp)
    endif()
    target_link_libraries(${app} PRIVATE inc_core inc_common)
    set_target_properties(${app} PROPERTIES OUTPUT_NAME ${app})
  endif()
endforeach()

# ---------------------------------------------------------------- host tools

# The .itbt packer is a build-time tool, not an application: it turns a plugin
# directory into the single-file container Infinity Toolbox installs from. It
# uses no third party library and no Windows API of its own, so it needs only
# the compiler. Building it from the same configure as the suite is what keeps
# the writer and the loader from drifting apart.
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/tools/itbt/itbt-pack.cpp)
  add_executable(itbt-pack ${CMAKE_CURRENT_SOURCE_DIR}/tools/itbt/itbt-pack.cpp)
endif()

# Explicit opt-in end-to-end test. It creates a uniquely named test storage
# repository and removes that repository before returning; it never touches an
# existing project/storage repo. Do not add it to the normal build invocation.
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/tests/store_smoke.cpp)
  add_executable(store-smoke EXCLUDE_FROM_ALL tests/store_smoke.cpp)
  target_link_libraries(store-smoke PRIVATE inc_core)
endif()
