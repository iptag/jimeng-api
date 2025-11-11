import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import { tokenSplit } from '@/api/controllers/core.ts';
import { createCompletion, createCompletionStream } from '@/api/controllers/chat.ts';

export default {

    prefix: '/v1/chat',

    post: {

        '/completions': async (request: Request) => {
            request
                .validate('body.model', v => _.isUndefined(v) || _.isString(v))
                .validate('body.messages', _.isArray)
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
            const { model, messages, stream, ratio, resolution, duration, sample_strength, negative_prompt } = request.body;
            const options = { ratio, resolution, duration, sample_strength, negative_prompt };
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