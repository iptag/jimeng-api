import _ from 'lodash';

import Body from './Body.ts';
import Exception from '../exceptions/Exception.ts';
import APIException from '../exceptions/APIException.ts';
import EX from '../consts/exceptions.ts';
import HTTP_STATUS_CODES from '../http-status-codes.ts';

export default class FailureBody extends Body {

    constructor(error: APIException | Exception | Error, _data?: any) {
        let errcode, errmsg, data = _data, httpStatusCode;
        if(_.isString(error))
            error = new Exception(EX.SYSTEM_ERROR, error);
        if(error instanceof APIException || error instanceof Exception) {
            ({ errcode, errmsg, data, httpStatusCode } = error);
        }
        else if(_.isError(error)) {
            const exception = new Exception(EX.SYSTEM_ERROR, error.message);
            ({ errcode, errmsg, data, httpStatusCode } = exception);
        }
        // 如果 httpStatusCode 仍然未定义，使用 500 作为默认值
        if (!httpStatusCode) {
            httpStatusCode = HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
        }
        super({
            code: errcode || -1,
            message: errmsg || 'Internal error',
            data,
            statusCode: httpStatusCode
        });
    }

    static isInstance(value) {
        return value instanceof FailureBody;
    }

}