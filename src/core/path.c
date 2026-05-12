#include "rtw/core/path.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

rtw_error_code rtw_path_join(char *buffer, size_t buffer_size, const char *left, const char *right) {
    int written;

    if (buffer == NULL || left == NULL || right == NULL || buffer_size == 0) {
        return RTW_ERR_INVALID_ARG;
    }

    if (left[0] == '\0') {
        written = snprintf(buffer, buffer_size, "%s", right);
    } else if (left[strlen(left) - 1] == '/') {
        written = snprintf(buffer, buffer_size, "%s%s", left, right);
    } else {
        written = snprintf(buffer, buffer_size, "%s/%s", left, right);
    }

    if (written < 0 || (size_t) written >= buffer_size) {
        return RTW_ERR_IO;
    }

    return RTW_OK;
}

int rtw_path_is_dir(const char *path) {
    struct stat st;

    if (path == NULL) {
        return 0;
    }

    if (stat(path, &st) != 0) {
        return 0;
    }

    return S_ISDIR(st.st_mode);
}

rtw_error_code rtw_path_ensure_dir(const char *path) {
    if (path == NULL || path[0] == '\0') {
        return RTW_ERR_INVALID_ARG;
    }

    if (mkdir(path, 0755) == 0 || errno == EEXIST) {
        return RTW_OK;
    }

    return RTW_ERR_IO;
}

rtw_error_code rtw_path_default_workspace(char *buffer, size_t buffer_size) {
    const char *home = getenv("HOME");

    if (buffer == NULL || buffer_size == 0) {
        return RTW_ERR_INVALID_ARG;
    }

    if (home == NULL || home[0] == '\0') {
        home = "/tmp";
    }

    return rtw_path_join(buffer, buffer_size, home, ".rtw");
}

