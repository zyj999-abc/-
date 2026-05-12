#include "rtw/model/sample.h"

#include <string.h>

static const char *rtw_sample_basename(const char *path) {
    const char *slash;

    slash = strrchr(path, '/');
    if (slash == NULL) {
        return path;
    }

    return slash + 1;
}

rtw_error_code rtw_sample_init(rtw_sample *sample, const char *input_path) {
    const char *display_name;
    size_t input_len;
    size_t name_len;

    if (sample == NULL || input_path == NULL || input_path[0] == '\0') {
        return RTW_ERR_INVALID_ARG;
    }

    input_len = strlen(input_path);
    if (input_len >= sizeof(sample->input_path)) {
        return RTW_ERR_IO;
    }

    memset(sample, 0, sizeof(*sample));
    memcpy(sample->input_path, input_path, input_len + 1);

    display_name = rtw_sample_basename(input_path);
    name_len = strlen(display_name);
    if (name_len >= sizeof(sample->display_name)) {
        return RTW_ERR_IO;
    }

    memcpy(sample->display_name, display_name, name_len + 1);
    return RTW_OK;
}

