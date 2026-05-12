#include "rtw/model/session.h"

#include <string.h>

rtw_error_code rtw_session_init(rtw_analysis_session *session, const char *session_id, const rtw_sample *sample) {
    size_t id_len;

    if (session == NULL || session_id == NULL || sample == NULL || session_id[0] == '\0') {
        return RTW_ERR_INVALID_ARG;
    }

    id_len = strlen(session_id);
    if (id_len >= sizeof(session->session_id)) {
        return RTW_ERR_IO;
    }

    memset(session, 0, sizeof(*session));
    memcpy(session->session_id, session_id, id_len + 1);
    session->sample = *sample;
    return RTW_OK;
}

