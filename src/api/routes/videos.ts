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
                    // 支持的时长范围: 4~15 (seedance 2.0 支持任意整数秒)
                    let num: number;
                    if (isMultiPart && typeof v === 'string') {
                        num = parseInt(v);
                    } else if (_.isFinite(v)) {
                        num = v as number;
                    } else {
                        return false;
                    }
                    return Number.isInteger(num) && num >= 4 && num <= 15;
                })
                // 限制图片URL数量最多2个
                .validate('body.file_paths', v => _.isUndefined(v) || (_.isArray(v) && v.length <= 2))
                .validate('body.filePaths', v => _.isUndefined(v) || (_.isArray(v) && v.length <= 2))
                .validate('body.functionMode', v => _.isUndefined(v) || (_.isString(v) && ['first_last_frames', 'omni_reference'].includes(v)))
                .validate('body.response_format', v => _.isUndefined(v) || _.isString(v))
                .validate('headers.authorization', _.isString);

            const functionMode = request.body.functionMode || 'first_last_frames';
            const isOmniMode = functionMode === 'omni_reference';

            // omni_reference 模式最多3个文件 (2图片+1视频)，普通模式最多2个
            const uploadedFiles = request.files ? _.values(request.files) : [];
            const maxFiles = isOmniMode ? 3 : 2;
            if (uploadedFiles.length > maxFiles) {
                throw new Error(isOmniMode ? '全能模式最多上传3个文件(2图片+1视频)' : '最多只能上传2个图片文件');
            }
            // omni_reference 模式至少需要上传1个素材文件
            const hasFilePaths = (request.body.filePaths?.length > 0) || (request.body.file_paths?.length > 0);
            // 检测 body 中以 URL 字符串形式传入的素材字段（如 -F "image_file_1=https://..."）
            const imageUrls: Record<string, string> = {};
            if (typeof request.body.image_file_1 === 'string' && request.body.image_file_1.startsWith('http')) {
                imageUrls.image_file_1 = request.body.image_file_1;
            }
            if (typeof request.body.image_file_2 === 'string' && request.body.image_file_2.startsWith('http')) {
                imageUrls.image_file_2 = request.body.image_file_2;
            }
            const hasImageUrls = Object.keys(imageUrls).length > 0;
            // 检测 body 中以 URL 字符串形式传入的视频字段
            const videoUrl = (typeof request.body.video_file === 'string' && request.body.video_file.startsWith('http'))
                ? request.body.video_file : undefined;
            if (isOmniMode && uploadedFiles.length === 0 && !hasFilePaths && !hasImageUrls && !videoUrl) {
                throw new Error('全能模式(omni_reference)至少需要上传1个素材文件(图片或视频)或提供素材URL');
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
            const generatedVideoUrl = await generateVideo(
                model,
                prompt,
                {
                    ratio,
                    resolution,
                    duration: finalDuration,
                    filePaths: finalFilePaths,
                    files: request.files, // 传递上传的文件
                    imageUrls,            // 传递 body 中的 URL 图片字段
                    videoUrl,             // 传递 body 中的 URL 视频字段
                    functionMode,
                },
                token
            );

            // 根据response_format返回不同格式的结果
            if (response_format === "b64_json") {
                // 获取视频内容并转换为BASE64
                const videoBase64 = await util.fetchFileBASE64(generatedVideoUrl);
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
                        url: generatedVideoUrl,
                        revised_prompt: prompt
                    }]
                };
            }
        }

    }

}