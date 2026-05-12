#include "rtw/app/bootstrap.h"

#include <stdio.h>

#include "rtw/core/error.h"
#include "rtw/core/log.h"
#include "rtw/model/sample.h"
#include "rtw/model/session.h"
#include "rtw/storage/session_store.h"
#include "rtw/storage/workspace.h"
#include "rtw/tui/app.h"

int bootstrap_run(int argc, char **argv) {
    rtw_workspace workspace;
    rtw_analysis_session session;
    rtw_analysis_session *active_session = NULL;
    const char *sample_path = NULL;
    rtw_error_code rc;

    if (argc > 1) {
        sample_path = argv[1];
    }

    rtw_log_set_level(RTW_LOG_INFO);
    rtw_log_message(RTW_LOG_INFO, "Starting Reverse TUI Workbench");

    rc = rtw_workspace_init(&workspace, NULL);
    if (RTW_FAILED(rc)) {
        fprintf(stderr, "workspace init failed: %s\n", rtw_error_string(rc));
        return rc;
    }

    if (sample_path != NULL) {
        rtw_sample sample;

        rc = rtw_sample_init(&sample, sample_path);
        if (RTW_FAILED(rc)) {
            fprintf(stderr, "sample init failed: %s\n", rtw_error_string(rc));
            return rc;
        }

        rc = rtw_session_store_create(&session, &workspace, &sample);
        if (RTW_FAILED(rc)) {
            fprintf(stderr, "session create failed: %s\n", rtw_error_string(rc));
            return rc;
        }

        active_session = &session;
        rtw_log_message(RTW_LOG_INFO, "Created analysis session");
    }

    rc = rtw_tui_run(&workspace, active_session);
    if (RTW_FAILED(rc)) {
        fprintf(stderr, "tui failed: %s\n", rtw_error_string(rc));
        return rc;
    }

    rtw_log_message(RTW_LOG_INFO, "Shutdown complete");
    return RTW_OK;
}

