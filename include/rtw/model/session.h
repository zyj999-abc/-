#ifndef RTW_MODEL_SESSION_H
#define RTW_MODEL_SESSION_H

#include "rtw/model/sample.h"

typedef struct {
    char session_id[64];
    char session_dir[RTW_PATH_SIZE];
    char manifest_path[RTW_PATH_SIZE];
    rtw_sample sample;
} rtw_analysis_session;

rtw_error_code rtw_session_init(rtw_analysis_session *session, const char *session_id, const rtw_sample *sample);

#endif

