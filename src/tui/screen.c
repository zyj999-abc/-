#include "rtw/tui/screen.h"

void rtw_screen_render_home(
    FILE *stream,
    const rtw_workspace *workspace,
    const rtw_analysis_session *session
) {
    if (stream == NULL || workspace == NULL) {
        return;
    }

    fprintf(stream, "==============================\n");
    fprintf(stream, " Reverse TUI Workbench (M2)\n");
    fprintf(stream, "==============================\n\n");
    fprintf(stream, "Status: minimal shell is running\n");
    fprintf(stream, "Workspace: %s\n", rtw_workspace_root(workspace));

    if (session != NULL) {
        fprintf(stream, "Session: %s\n", session->session_id);
        fprintf(stream, "Sample: %s\n", session->sample.display_name);
        fprintf(stream, "Manifest: %s\n", session->manifest_path);
    } else {
        fprintf(stream, "Session: no active session\n");
        fprintf(stream, "Hint: pass a sample path to create a session\n");
    }

    fprintf(stream, "Next: task model, workflow engine, first analysis capabilities\n");
}

