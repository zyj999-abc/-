#include "rtw/storage/workspace.h"

#include <string.h>

#include "rtw/core/path.h"

static rtw_error_code rtw_workspace_build_paths(rtw_workspace *workspace) {
    rtw_error_code rc;

    rc = rtw_path_join(workspace->samples, sizeof(workspace->samples), workspace->root, "samples");
    if (RTW_FAILED(rc)) {
        return rc;
    }

    rc = rtw_path_join(workspace->sessions, sizeof(workspace->sessions), workspace->root, "sessions");
    if (RTW_FAILED(rc)) {
        return rc;
    }

    rc = rtw_path_join(workspace->cache, sizeof(workspace->cache), workspace->root, "cache");
    if (RTW_FAILED(rc)) {
        return rc;
    }

    return RTW_OK;
}

rtw_error_code rtw_workspace_init(rtw_workspace *workspace, const char *root_override) {
    rtw_error_code rc;
    size_t len;

    if (workspace == NULL) {
        return RTW_ERR_INVALID_ARG;
    }

    memset(workspace, 0, sizeof(*workspace));

    if (root_override != NULL && root_override[0] != '\0') {
        rc = rtw_path_join(workspace->root, sizeof(workspace->root), root_override, "");
        if (RTW_FAILED(rc)) {
            return rc;
        }

        len = strlen(workspace->root);
        if (len > 0 && workspace->root[len - 1] == '/') {
            workspace->root[len - 1] = '\0';
        }
    } else {
        rc = rtw_path_default_workspace(workspace->root, sizeof(workspace->root));
        if (RTW_FAILED(rc)) {
            return rc;
        }
    }

    rc = rtw_workspace_build_paths(workspace);
    if (RTW_FAILED(rc)) {
        return rc;
    }

    rc = rtw_path_ensure_dir(workspace->root);
    if (RTW_FAILED(rc)) {
        return rc;
    }

    rc = rtw_path_ensure_dir(workspace->samples);
    if (RTW_FAILED(rc)) {
        return rc;
    }

    rc = rtw_path_ensure_dir(workspace->sessions);
    if (RTW_FAILED(rc)) {
        return rc;
    }

    rc = rtw_path_ensure_dir(workspace->cache);
    if (RTW_FAILED(rc)) {
        return rc;
    }

    return RTW_OK;
}

const char *rtw_workspace_root(const rtw_workspace *workspace) {
    if (workspace == NULL) {
        return "";
    }

    return workspace->root;
}

