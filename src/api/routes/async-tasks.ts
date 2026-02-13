import fs from 'fs';
import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import { generateImages, generateImageComposition } from '@/api/controllers/images.ts';
import { generateVideo, DEFAULT_MODEL as DEFAULT_VIDEO_MODEL } from '@/api/controllers/videos.ts';
import { DEFAULT_IMAGE_MODEL } from '@/api/consts/common.ts';
import { tokenSplit } from '@/api/controllers/core.ts';
import taskManager, { TaskStatus } from '@/lib/task-manager.ts';
import util from '@/lib/util.ts';
import logger from '@/lib/logger.ts';

export default {
  prefix: '/v1/async',

  post: {
    /**
     * 异步文生图
     *
     * POST /v1/async/images/generations
     * 立即返回 task_id，通过 GET /v1/tasks/:task_id 查询结果
     */
    '/images/generations': async (request: Request) => {
      request
        .validate('body.model', v => _.isUndefined(v) || _.isString(v))
        .validate('body.prompt', _.isString)
        .validate('body.negative_prompt', v => _.isUndefined(v) || _.isString(v))
        .validate('body.ratio', v => _.isUndefined(v) || _.isString(v))
        .validate('body.resolution', v => _.isUndefined(v) || _.isString(v))
        .validate('body.intelligent_ratio', v => _.isUndefined(v) || _.isBoolean(v))
        .validate('body.sample_strength', v => _.isUndefined(v) || _.isFinite(v))
        .validate('body.response_format', v => _.isUndefined(v) || _.isString(v))
        .validate('headers.authorization', _.isString);

      const tokens = tokenSplit(request.headers.authorization);
      const token = _.sample(tokens);
      const {
        model,
        prompt,
        negative_prompt: negativePrompt,
        ratio,
        resolution,
        intelligent_ratio: intelligentRatio,
        sample_strength: sampleStrength,
        response_format,
      } = request.body;

      const finalModel = _.defaultTo(model, DEFAULT_IMAGE_MODEL);
      const responseFormat = _.defaultTo(response_format, 'url');

      const task = taskManager.create(
        'image_generation',
        async () => {
          const imageUrls = await generateImages(finalModel, prompt, {
            ratio,
            resolution,
            sampleStrength,
            negativePrompt,
            intelligentRatio,
          }, token);

          let data;
          if (responseFormat === 'b64_json') {
            data = (
              await Promise.all(imageUrls.map(url => util.fetchFileBASE64(url)))
            ).map(b64 => ({ b64_json: b64 }));
          } else {
            data = imageUrls.map(url => ({ url }));
          }

          return { created: util.unixTimestamp(), data };
        },
        { model: finalModel, prompt, ratio, resolution }
      );

      return {
        task_id: task.task_id,
        status: task.status,
        type: task.type,
        created_at: task.created_at,
        poll_url: `/v1/tasks/${task.task_id}`,
      };
    },

    /**
     * 异步图生图
     *
     * POST /v1/async/images/compositions
     */
    '/images/compositions': async (request: Request) => {
      const contentType = request.headers['content-type'] || '';
      const isMultiPart = contentType.startsWith('multipart/form-data');

      if (isMultiPart) {
        request
          .validate('body.model', v => _.isUndefined(v) || _.isString(v))
          .validate('body.prompt', _.isString)
          .validate('body.negative_prompt', v => _.isUndefined(v) || _.isString(v))
          .validate('body.ratio', v => _.isUndefined(v) || _.isString(v))
          .validate('body.resolution', v => _.isUndefined(v) || _.isString(v))
          .validate('body.intelligent_ratio', v => _.isUndefined(v) || (typeof v === 'string' && (v === 'true' || v === 'false')) || _.isBoolean(v))
          .validate('body.sample_strength', v => _.isUndefined(v) || (typeof v === 'string' && !isNaN(parseFloat(v))) || _.isFinite(v))
          .validate('body.response_format', v => _.isUndefined(v) || _.isString(v))
          .validate('headers.authorization', _.isString);
      } else {
        request
          .validate('body.model', v => _.isUndefined(v) || _.isString(v))
          .validate('body.prompt', _.isString)
          .validate('body.images', _.isArray)
          .validate('body.negative_prompt', v => _.isUndefined(v) || _.isString(v))
          .validate('body.ratio', v => _.isUndefined(v) || _.isString(v))
          .validate('body.resolution', v => _.isUndefined(v) || _.isString(v))
          .validate('body.intelligent_ratio', v => _.isUndefined(v) || _.isBoolean(v))
          .validate('body.sample_strength', v => _.isUndefined(v) || _.isFinite(v))
          .validate('body.response_format', v => _.isUndefined(v) || _.isString(v))
          .validate('headers.authorization', _.isString);
      }

      // 解析图片数据（必须在主线程做，因为临时文件可能被清理）
      let images: (string | Buffer)[] = [];
      if (isMultiPart) {
        const files = (request.files as any)?.images;
        if (!files) throw new Error("在form-data中缺少 'images' 字段");
        const imageFiles = Array.isArray(files) ? files : [files];
        if (imageFiles.length === 0) throw new Error('至少需要提供1张输入图片');
        if (imageFiles.length > 10) throw new Error('最多支持10张输入图片');
        images = imageFiles.map(file => fs.readFileSync(file.filepath));
      } else {
        const bodyImages = request.body.images;
        if (!bodyImages || bodyImages.length === 0) throw new Error('至少需要提供1张输入图片');
        if (bodyImages.length > 10) throw new Error('最多支持10张输入图片');
        bodyImages.forEach((image: any, index: number) => {
          if (!_.isString(image) && !_.isObject(image)) {
            throw new Error(`图片 ${index + 1} 格式不正确`);
          }
          if (_.isObject(image) && !(image as any).url) {
            throw new Error(`图片 ${index + 1} 缺少url字段`);
          }
        });
        images = bodyImages.map((image: any) => _.isString(image) ? image : image.url);
      }

      const tokens = tokenSplit(request.headers.authorization);
      const token = _.sample(tokens);
      const {
        model,
        prompt,
        negative_prompt: negativePrompt,
        ratio,
        resolution,
        intelligent_ratio: intelligentRatio,
        sample_strength: sampleStrength,
        response_format,
      } = request.body;

      const finalModel = _.defaultTo(model, DEFAULT_IMAGE_MODEL);
      const finalSampleStrength = isMultiPart && typeof sampleStrength === 'string'
        ? parseFloat(sampleStrength) : sampleStrength;
      const finalIntelligentRatio = isMultiPart && typeof intelligentRatio === 'string'
        ? intelligentRatio === 'true' : intelligentRatio;
      const responseFormat = _.defaultTo(response_format, 'url');

      const task = taskManager.create(
        'image_composition',
        async () => {
          const resultUrls = await generateImageComposition(finalModel, prompt, images, {
            ratio,
            resolution,
            sampleStrength: finalSampleStrength,
            negativePrompt,
            intelligentRatio: finalIntelligentRatio,
          }, token);

          let data;
          if (responseFormat === 'b64_json') {
            data = (
              await Promise.all(resultUrls.map(url => util.fetchFileBASE64(url)))
            ).map(b64 => ({ b64_json: b64 }));
          } else {
            data = resultUrls.map(url => ({ url }));
    }

          return {
            created: util.unixTimestamp(),
            data,
            input_images: images.length,
            composition_type: 'multi_image_synthesis',
          };
        },
        { model: finalModel, prompt, ratio, resolution, imageCount: images.length }
      );

      return {
        task_id: task.task_id,
        status: task.status,
        type: task.type,
        created_at: task.created_at,
        poll_url: `/v1/tasks/${task.task_id}`,
      };
    },

    /**
     * 异步视频生成
     *
     * POST /v1/async/videos/generations
     */
    '/videos/generations': async (request: Request) => {
      const contentType = request.headers['content-type'] || '';
      const isMultiPart = contentType.startsWith('multipart/form-data');

      request
        .validate('body.model', v => _.isUndefined(v) || _.isString(v))
        .validate('body.prompt', _.isString)
        .validate('body.ratio', v => _.isUndefined(v) || _.isString(v))
        .validate('body.resolution', v => _.isUndefined(v) || _.isString(v))
        .validate('body.functionMode', v => _.isUndefined(v) || (_.isString(v) && ['first_last_frames', 'omni_reference'].includes(v)))
        .validate('body.response_format', v => _.isUndefined(v) || _.isString(v))
        .validate('headers.authorization', _.isString);

      const functionMode = request.body.functionMode || 'first_last_frames';

      // duration 验证（复用现有逻辑）
      if (!_.isUndefined(request.body.duration)) {
        const modelName = request.body.model || DEFAULT_VIDEO_MODEL;
        let durationValue: number;
        if (isMultiPart && typeof request.body.duration === 'string') {
          durationValue = parseInt(request.body.duration, 10);
          if (!Number.isInteger(durationValue) || request.body.duration.trim() !== String(durationValue)) {
            throw new Error(`duration 必须是整数，当前值: ${request.body.duration}`);
          }
        } else if (_.isFinite(request.body.duration)) {
          durationValue = request.body.duration as number;
          if (!Number.isInteger(durationValue)) {
            throw new Error(`duration 必须是整数，当前值: ${durationValue}`);
          }
        } else {
          throw new Error('duration 参数格式错误');
        }

        let validDurations: number[] = [];
        let errorMessage = '';
        if (modelName.includes('veo3.1') || modelName.includes('veo3')) {
          validDurations = [8];
          errorMessage = 'veo3 模型仅支持 8 秒时长';
        } else if (modelName.includes('sora2')) {
          validDurations = [4, 8, 12];
          errorMessage = 'sora2 模型仅支持 4、8、12 秒时长';
        } else if (modelName.includes('3.5-pro') || modelName.includes('3.5_pro')) {
          validDurations = [5, 10, 12];
          errorMessage = '3.5-pro 模型仅支持 5、10、12 秒时长';
        } else if (modelName.includes('seedance-2.0') || modelName.includes('40_pro') || modelName.includes('40-pro') || modelName.includes('seedance-2.0-fast')) {
          if (durationValue < 4 || durationValue > 15) {
            throw new Error(`seedance 2.0/2.0-fast 模型支持 4~15 秒时长，当前值: ${durationValue}`);
          }
        } else {
          validDurations = [5, 10];
          errorMessage = '该模型仅支持 5、10 秒时长';
        }
        if (validDurations.length > 0 && !validDurations.includes(durationValue)) {
          throw new Error(`${errorMessage}，当前值: ${durationValue}`);
        }
      }

      request
        .validate('body.file_paths', v => _.isUndefined(v) || (_.isArray(v) && v.length <= 2))
        .validate('body.filePaths', v => _.isUndefined(v) || (_.isArray(v) && v.length <= 2));

      const tokens = tokenSplit(request.headers.authorization);
      const token = _.sample(tokens);

      const {
        model = DEFAULT_VIDEO_MODEL,
        prompt,
        ratio = '1:1',
        resolution = '720p',
        duration = 5,
        file_paths = [],
        filePaths = [],
        response_format = 'url',
      } = request.body;

      const finalDuration = isMultiPart && typeof duration === 'string'
        ? parseInt(duration) : duration;
      const finalFilePaths = filePaths.length > 0 ? filePaths : file_paths;

      // 注意：对于 multipart 上传的文件，需要在主线程里拿到 files 引用
      const files = request.files;
      const httpRequest = request;

      const task = taskManager.create(
        'video_generation',
        async () => {
          const generatedVideoUrl = await generateVideo(
            model,
            prompt,
            {
              ratio,
              resolution,
              duration: finalDuration,
              filePaths: finalFilePaths,
              files,
              httpRequest,
              functionMode,
            },
            token
          );

          if (response_format === 'b64_json') {
            const videoBase64 = await util.fetchFileBASE64(generatedVideoUrl);
            return {
              created: util.unixTimestamp(),
              data: [{ b64_json: videoBase64, revised_prompt: prompt }],
            };
          } else {
            return {
              created: util.unixTimestamp(),
              data: [{ url: generatedVideoUrl, revised_prompt: prompt }],
            };
          }
        },
        { model, prompt, ratio, resolution, duration: finalDuration }
      );

      return {
        task_id: task.task_id,
        status: task.status,
        type: task.type,
        created_at: task.created_at,
        poll_url: `/v1/tasks/${task.task_id}`,
      };
    },
  },

  get: {
    /**
     * 查询单个任务状态
     *
     * GET /v1/async/tasks/:task_id
     */
    '/tasks/:task_id': async (request: Request) => {
      const taskId = request.params.task_id;
      const task = taskManager.get(taskId);

      if (!task) {
        throw new Error(`任务不存在: ${taskId}`);
      }

      return task;
    },

    /**
     * 列出所有任务
     *
     * GET /v1/async/tasks?status=pending|processing|completed|failed
     */
    '/tasks': async (request: Request) => {
      const status = request.query?.status as TaskStatus | undefined;
      const tasks = taskManager.list(status);
      const stats = taskManager.stats();

      return {
        tasks,
        stats,
      };
    },
  },
};
