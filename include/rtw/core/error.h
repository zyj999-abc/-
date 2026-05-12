#ifndef RTW_CORE_ERROR_H
#define RTW_CORE_ERROR_H

typedef enum {
    RTW_OK = 0,
    RTW_ERR_INVALID_ARG = 1,
    RTW_ERR_IO = 2,
    RTW_ERR_ALLOC = 3,
    RTW_ERR_STATE = 4,
    RTW_ERR_NOT_IMPLEMENTED = 5
} rtw_error_code;

#define RTW_SUCCEEDED(code) ((code) == RTW_OK)
#define RTW_FAILED(code) ((code) != RTW_OK)

const char *rtw_error_string(rtw_error_code code);

#endif
