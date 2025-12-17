import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import { getTokenLiveStatus, getCredit, receiveCredit, tokenSplit } from '@/api/controllers/core.ts';
import logger from '@/lib/logger.ts';

export default {

    prefix: '/token',

    post: {

        '/check': async (request: Request) => {
            request
                .validate('body.token', _.isString)
            const live = await getTokenLiveStatus(request.body.token);
            return {
                live
            }
        },

        '/points': async (request: Request) => {
            request
                .validate('headers.authorization', _.isString)
            // refresh_token切分
            const tokens = tokenSplit(request.headers.authorization);
            const points = await Promise.all(tokens.map(async (token) => {
                return {
                    token,
                    points: await getCredit(token)
                }
            }))
            return points;
        },

        '/receive': async (request: Request) => {
            request
                .validate('headers.authorization', _.isString)
            // refresh_token切分
            const tokens = tokenSplit(request.headers.authorization);
            const results = await Promise.all(tokens.map(async (token) => {
                try {
                    // 尝试领取积分
                    await receiveCredit(token);
                    // 获取最新积分信息
                    const creditInfo = await getCredit(token);
                    return {
                        token,
                        success: true,
                        ...creditInfo
                    }
                } catch (e) {
                    logger.error(`Token ${token.substring(0, 10)}... 领取积分失败: ${e.message}`);
                    return {
                        token,
                        success: false,
                        error: e.message
                    }
                }
            }))
            return results;
        }

    }

}