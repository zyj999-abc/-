#include "rtw/core/error.h"

const char *rtw_error_string(rtw_error_code code) {
    switch (code) {
        case RTW_OK:
            return "ok";
        case RTW_ERR_INVALID_ARG:
            return "invalid argument";
        case RTW_ERR_IO:
            return "io error";
        case RTW_ERR_ALLOC:
            return "allocation error";
        case RTW_ERR_STATE:
            return "invalid state";
        case RTW_ERR_NOT_IMPLEMENTED:
            return "not implemented";
        default:
            return "unknown error";
    }
}
