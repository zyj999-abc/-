#include "rtw/tui/app.h"

#include <stdio.h>

#include "rtw/core/error.h"
#include "rtw/core/log.h"
#include "rtw/tui/screen.h"

int rtw_tui_run(const rtw_workspace *workspace, const rtw_analysis_session *session) {
    if (workspace == NULL) {
        return RTW_ERR_INVALID_ARG;
    }

    rtw_log_message(RTW_LOG_INFO, "Launching minimal TUI shell");
    rtw_screen_render_home(stdout, workspace, session);
    return RTW_OK;
}

