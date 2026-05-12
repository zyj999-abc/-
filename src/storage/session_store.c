#include "rtw/storage/session_store.h"

#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "rtw/core/path.h"

static rtw_error_code rtw_session_build_id(char *buffer, size_t buffer_size) {
    time_t now;
    struct tm *tm_now;
    int written;

    now = time(NULL);
    tm_now = localtime(&now);
    if (tm_now == NULL) {
        return RTW_ERR_STATE;
    }

    written = snprintf(
        buffer,
        buffer_size,
        "%04d%02d%02d-%02d%02d%02d-%ld",
        tm_now->tm_year + 1900,
        tm_now->tm_mon + 1,
        tm_now->tm_mday,
        tm_now->tm_hour,
        tm_now->tm_min,
        tm_now->tm_sec,
        (long) getpid()
    );
    if (written < 0 || (size_t) written >= buffer_size) {
        return RTW_ERR_IO;
    }

    return RTW_OK;
}

rtw_error_code rtw_session_store_create(
    rtw_analysis_session *session,
    const rtw_workspace *workspace,
    const rtw_sample *sample
) {
    char session_id[64];
    FILE *manifest;
    rtw_error_code rc;

    if (session == NULL || workspace == NULL || sample == NULL) {
        return RTW_ERR_INVALID_ARG;
    }

    rc = rtw_session_build_id(session_id, sizeof(session_id));
    if (RTW_FAILED(rc)) {
        return rc;
    }

    rc = rtw_session_init(session, session_id, sample);
    if (RTW_FAILED(rc)) {
        return rc;
    }

    rc = rtw_path_join(session->session_dir, sizeof(session->session_dir), workspace->sessions, session->session_id);
    if (RTW_FAILED(rc)) {
        return rc;
    }

    rc = rtw_path_ensure_dir(session->session_dir);
    if (RTW_FAILED(rc)) {
        return rc;
    }

    rc = rtw_path_join(session->manifest_path, sizeof(session->manifest_path), session->session_dir, "session.txt");
    if (RTW_FAILED(rc)) {
        return rc;
    }

    manifest = fopen(session->manifest_path, "w");
    if (manifest == NULL) {
        return RTW_ERR_IO;
    }

    fprintf(manifest, "session_id=%s\n", session->session_id);
    fprintf(manifest, "sample_path=%s\n", session->sample.input_path);
    fprintf(manifest, "sample_name=%s\n", session->sample.display_name);

    if (fclose(manifest) != 0) {
        return RTW_ERR_IO;
    }

    return RTW_OK;
}

