#ifndef RTW_STORAGE_SESSION_STORE_H
#define RTW_STORAGE_SESSION_STORE_H

#include "rtw/model/session.h"
#include "rtw/storage/workspace.h"

rtw_error_code rtw_session_store_create(
    rtw_analysis_session *session,
    const rtw_workspace *workspace,
    const rtw_sample *sample
);

#endif

