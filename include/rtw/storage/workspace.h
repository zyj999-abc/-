#ifndef RTW_STORAGE_WORKSPACE_H
#define RTW_STORAGE_WORKSPACE_H

#include <stddef.h>

#include "rtw/core/error.h"

#define RTW_PATH_SIZE 4096

typedef struct {
    char root[RTW_PATH_SIZE];
    char samples[RTW_PATH_SIZE];
    char sessions[RTW_PATH_SIZE];
    char cache[RTW_PATH_SIZE];
} rtw_workspace;

rtw_error_code rtw_workspace_init(rtw_workspace *workspace, const char *root_override);
const char *rtw_workspace_root(const rtw_workspace *workspace);

#endif
