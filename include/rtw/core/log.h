#ifndef RTW_CORE_LOG_H
#define RTW_CORE_LOG_H

typedef enum {
    RTW_LOG_DEBUG = 0,
    RTW_LOG_INFO = 1,
    RTW_LOG_WARN = 2,
    RTW_LOG_ERROR = 3
} rtw_log_level;

void rtw_log_set_level(rtw_log_level level);
void rtw_log_message(rtw_log_level level, const char *message);

#endif
