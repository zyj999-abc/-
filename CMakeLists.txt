cmake_minimum_required(VERSION 3.16)
project(rtw C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

add_executable(rtw
    src/app/main.c
    src/app/bootstrap.c
    src/core/error.c
    src/core/log.c
    src/core/path.c
    src/model/sample.c
    src/model/session.c
    src/storage/workspace.c
    src/storage/session_store.c
    src/tui/app.c
    src/tui/screen.c
)

target_include_directories(rtw
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

