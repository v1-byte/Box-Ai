cmake_minimum_required(VERSION 3.22.1)
project(boxai_jni LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# --- llama.cpp: versi DIPATOK. Ganti tag ini hanya setelah menguji ulang boxai_jni.cpp. ---
set(LLAMA_CPP_TAG "b5001" CACHE STRING "Tag rilis llama.cpp (https://github.com/ggml-org/llama.cpp/tags)")

# ggml tanpa optimasi (-O0) membuat inferensi puluhan kali lebih lambat; selalu Release,
# juga untuk APK debug.
set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)

include(FetchContent)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
    llama
    GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
    GIT_TAG ${LLAMA_CPP_TAG}
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(llama)

add_library(boxai_jni SHARED boxai_jni.cpp)
target_link_libraries(boxai_jni PRIVATE llama ggml android log)
