#ifndef RTW_MODEL_SAMPLE_H
#define RTW_MODEL_SAMPLE_H

#include "rtw/core/error.h"
#include "rtw/storage/workspace.h"

typedef struct {
    char input_path[RTW_PATH_SIZE];
    char display_name[256];
} rtw_sample;

rtw_error_code rtw_sample_init(rtw_sample *sample, const char *input_path);

#endif

