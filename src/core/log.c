#include "rtw/core/log.h"

#include <stdio.h>

static rtw_log_level g_log_level = RTW_LOG_INFO;

static const char *rtw_log_level_name(rtw_log_level level) {
    switch (level) {
        case RTW_LOG_DEBUG:
            return "DEBUG";
        case RTW_LOG_INFO:
            return "INFO";
        case RTW_LOG_WARN:
            return "WARN";
        case RTW_LOG_ERROR:
            return "ERROR";
        default:
            return "LOG";
    }
}

void rtw_log_set_level(rtw_log_level level) {
    g_log_level = level;
}

void rtw_log_message(rtw_log_level level, const char *message) {
    if (level < g_log_level || message == NULL) {
        return;
    }

    fprintf(stderr, "[%s] %s\n", rtw_log_level_name(level), message);
}

