import assert from 'assert';

import _ from 'lodash';
import HTTP_STATUS_CODES from '../http-status-codes.ts';

export default class Exception extends Error {

    /** 错误码 */
    errcode: number;
    /** 错误消息 */
    errmsg: string;
    /** 数据 */
    data: any;
    /** HTTP状态码 */
    httpStatusCode: number;

    /**
     * 构造异常
     *
     * @param exception 异常
     * @param _errmsg 异常消息
     */
    constructor(exception: (string | number)[], _errmsg?: string) {
        assert(_.isArray(exception), 'Exception must be Array');
        const [errcode, errmsg] = exception as [number, string];
        assert(_.isFinite(errcode), 'Exception errcode invalid');
        assert(_.isString(errmsg), 'Exception errmsg invalid');
        super(_errmsg || errmsg);
        this.errcode = errcode;
        this.errmsg = _errmsg || errmsg;
        // 根据错误码自动设置合适的 HTTP 状态码
        this.httpStatusCode = this.mapErrorCodeToHttpStatus(errcode);
    }

    /**
     * 将应用错误码映射到 HTTP 状态码
     *
     * @param errcode 应用错误码
     * @returns HTTP 状态码
     */
    private mapErrorCodeToHttpStatus(errcode: number): number {
        // 参数验证错误 -> 400 Bad Request
        if (errcode === -1001 || errcode === -2000 || errcode === -2003 || errcode === -2006) {
            return HTTP_STATUS_CODES.BAD_REQUEST;
        }
        // Token 失效 -> 401 Unauthorized
        if (errcode === -2002) {
            return HTTP_STATUS_CODES.UNAUTHORIZED;
        }
        // 路由不匹配 -> 404 Not Found
        if (errcode === -1002) {
            return HTTP_STATUS_CODES.NOT_FOUND;
        }
        // 文件超出大小 -> 413 Request Entity Too Large
        if (errcode === -2004) {
            return HTTP_STATUS_CODES.REQUEST_ENTITY_TOO_LARGE;
        }
        // 积分不足 -> 402 Payment Required
        if (errcode === -2009) {
            return HTTP_STATUS_CODES.PAYMENT_REQUIRED;
        }
        // 其他所有错误 -> 500 Internal Server Error
        return HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
    }

    compare(exception: (string | number)[]) {
        const [errcode] = exception as [number, string];
        return this.errcode == errcode;
    }

    setHTTPStatusCode(value: number) {
        this.httpStatusCode = value;
        return this;
    }

    setData(value: any) {
        this.data = _.defaultTo(value, null);
        return this;
    }

}