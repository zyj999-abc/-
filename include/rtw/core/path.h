#ifndef RTW_CORE_PATH_H
#define RTW_CORE_PATH_H

#include <stddef.h>

#include "rtw/core/error.h"

rtw_error_code rtw_path_join(char *buffer, size_t buffer_size, const char *left, const char *right);
int rtw_path_is_dir(const char *path);
rtw_error_code rtw_path_ensure_dir(const char *path);
rtw_error_code rtw_path_default_workspace(char *buffer, size_t buffer_size);

#endif
