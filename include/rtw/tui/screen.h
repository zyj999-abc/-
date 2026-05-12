#ifndef RTW_TUI_SCREEN_H
#define RTW_TUI_SCREEN_H

#include <stdio.h>

#include "rtw/model/session.h"
#include "rtw/storage/workspace.h"

void rtw_screen_render_home(
    FILE *stream,
    const rtw_workspace *workspace,
    const rtw_analysis_session *session
);

#endif

