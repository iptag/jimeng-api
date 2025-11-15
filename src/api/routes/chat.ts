import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import { tokenSplit } from '@/api/controllers/core.ts';
import { createCompletion, createCompletionStream } from '@/api/controllers/chat.ts';

/**
 * 将 size 参数转换为 ratio 格式
 * 支持两种格式:
 * 1. 比例格式: "3:4", "16:9" -> 直接返回
 * 2. 像素格式: "1024x1024" -> "1:1", "1792x1024" -> "16:9"
 */
function sizeToRatio(size: string): string {
    // 如果已经是比例格式（如 "3:4"），直接返回
    if (size.includes(':')) {
        return size;
    }
    
    // 否则按照像素格式处理（如 "1024x1024"）
    const match = size.match(/(\d+)x(\d+)/);
    if (!match) return "1:1";
    
    const width = parseInt(match[1]);
    const height = parseInt(match[2]);
    
    // 计算最大公约数
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const divisor = gcd(width, height);
    
    return `${width / divisor}:${height / divisor}`;
}

export default {

    prefix: '/v1/chat',

    post: {

        '/completions': async (request: Request) => {
            request
                .validate('body.model', v => _.isUndefined(v) || _.isString(v))
                .validate('body.messages', _.isArray)
                .validate('body.size', v => _.isUndefined(v) || _.isString(v))
                .validate('body.ratio', v => _.isUndefined(v) || _.isString(v))
                .validate('body.resolution', v => _.isUndefined(v) || _.isString(v))
                .validate('body.duration', v => _.isUndefined(v) || _.isNumber(v))
                .validate('body.sample_strength', v => _.isUndefined(v) || _.isNumber(v))
                .validate('body.negative_prompt', v => _.isUndefined(v) || _.isString(v))
                .validate('headers.authorization', _.isString)
            // refresh_token切分
            const tokens = tokenSplit(request.headers.authorization);
            // 随机挑选一个refresh_token
            const token = _.sample(tokens);
            const { model, messages, stream, size, ratio, resolution, duration, sample_strength, negative_prompt } = request.body;
            
            // 如果提供了 size 参数，将其转换为 ratio（ratio 参数优先级更高）
            let finalRatio = ratio;
            if (!finalRatio && size) {
                finalRatio = sizeToRatio(size);
            }
            
            const options = { ratio: finalRatio, resolution, duration, sample_strength, negative_prompt };
            if (stream) {
                const stream = await createCompletionStream(messages, token, model, options);
                return new Response(stream, {
                    type: "text/event-stream"
                });
            }
            else
                return await createCompletion(messages, token, model, options);
        }

    }

}