import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import { tokenSplit } from '@/api/controllers/core.ts';
import { generateVideo, DEFAULT_MODEL } from '@/api/controllers/videos.ts';
import util from '@/lib/util.ts';

export default {

    prefix: '/v1/videos',

    post: {

        '/generations': async (request: Request) => {
            const contentType = request.headers['content-type'] || '';
            const isMultiPart = contentType.startsWith('multipart/form-data');

            request
                .validate('body.model', v => _.isUndefined(v) || _.isString(v))
                .validate('body.prompt', _.isString)
                .validate('body.ratio', v => _.isUndefined(v) || _.isString(v))
                .validate('body.resolution', v => _.isUndefined(v) || _.isString(v))
                .validate('body.duration', v => {
                    if (_.isUndefined(v)) return true;
                    // 支持的时长: 4/8/12 (sora2) 和 5/10 (其他模型)
                    const validDurations = [4, 5, 8, 10, 12];
                    // 对于 multipart/form-data，允许字符串类型的数字
                    if (isMultiPart && typeof v === 'string') {
                        const num = parseInt(v);
                        return validDurations.includes(num);
                    }
                    // 对于 JSON，要求数字类型
                    return _.isFinite(v) && validDurations.includes(v);
                })
                // 限制图片URL数量最多2个
                .validate('body.file_paths', v => _.isUndefined(v) || (_.isArray(v) && v.length <= 2))
                .validate('body.filePaths', v => _.isUndefined(v) || (_.isArray(v) && v.length <= 2))
                .validate('body.response_format', v => _.isUndefined(v) || _.isString(v))
                .validate('headers.authorization', _.isString);

            // 限制上传文件数量最多2个
            const uploadedFiles = request.files ? _.values(request.files) : [];
            if (uploadedFiles.length > 2) {
                throw new Error('最多只能上传2个图片文件');
            }

            // refresh_token切分
            const tokens = tokenSplit(request.headers.authorization);
            // 随机挑选一个refresh_token
            const token = _.sample(tokens);

            const {
                model = DEFAULT_MODEL,
                prompt,
                ratio = "1:1",
                resolution = "720p",
                duration = 5,
                file_paths = [],
                filePaths = [],
                response_format = "url"
            } = request.body;

            // 如果是 multipart/form-data，需要将字符串转换为数字
            const finalDuration = isMultiPart && typeof duration === 'string'
                ? parseInt(duration)
                : duration;

            // 兼容两种参数名格式：file_paths 和 filePaths
            const finalFilePaths = filePaths.length > 0 ? filePaths : file_paths;

            // 生成视频
            const videoUrl = await generateVideo(
                model,
                prompt,
                {
                    ratio,
                    resolution,
                    duration: finalDuration,
                    filePaths: finalFilePaths,
                    files: request.files, // 传递上传的文件
                },
                token
            );

            // 根据response_format返回不同格式的结果
            if (response_format === "b64_json") {
                // 获取视频内容并转换为BASE64
                const videoBase64 = await util.fetchFileBASE64(videoUrl);
                return {
                    created: util.unixTimestamp(),
                    data: [{
                        b64_json: videoBase64,
                        revised_prompt: prompt
                    }]
                };
            } else {
                // 默认返回URL
                return {
                    created: util.unixTimestamp(),
                    data: [{
                        url: videoUrl,
                        revised_prompt: prompt
                    }]
                };
            }
        }

    }

}