import fs from "fs";
import _ from "lodash";

import Request from "@/lib/request/Request.ts";
import { generateImages, generateImageComposition, generateImageEdits } from "@/api/controllers/images.ts";
import { tokenSplit } from "@/api/controllers/core.ts";
import util from "@/lib/util.ts";

// OpenAI 参数映射函数
function mapSizeToRatio(size: string): string {
  const sizeToRatioMap: { [key: string]: string } = {
    '1024x1024': '1:1',
    '1536x1024': '3:2',
    '1024x1536': '2:3',
    'auto': '16:9'
  };
  return sizeToRatioMap[size] || '1:1';
}

function mapQualityToResolution(quality: string): string {
  const qualityToResolutionMap: { [key: string]: string } = {
    'high': '1k',
    'medium': '2k',
    'low': '4k'
  };
  return qualityToResolutionMap[quality] || '2k';
}

function mapOpenAIParamsToInternal(openaiParams: any) {
  // 处理 negative_prompt 连接到 prompt 末尾
  let finalPrompt = openaiParams.prompt || '';
  if (openaiParams.negative_prompt) {
    finalPrompt = `${finalPrompt} negative_prompt: ${openaiParams.negative_prompt}`;
  }

  return {
    model: openaiParams.model,
    prompt: finalPrompt,
    images: openaiParams.image || openaiParams.image || [], // 处理 image[] 数组或单个 image
    ratio: mapSizeToRatio(openaiParams.size || '1024x1024'),
    resolution: mapQualityToResolution(openaiParams.quality || 'medium'),
    sampleStrength: openaiParams.sample_strength,
    responseFormat: openaiParams.response_format || "url"
  };
}

async function formatOpenAIResponse(resultUrls: string[], responseFormat: string, created: number) {
  if (responseFormat === "b64_json") {
    const b64Array = await Promise.all(resultUrls.map((url) => util.fetchFileBASE64(url)));
    const data = b64Array.map((b64) => ({ b64_json: b64 }));
    return { created, data };
  } else {
    const data = resultUrls.map((url) => ({ url }));
    return { created, data };
  }
}

export default {
  prefix: "/v1/images",

  post: {
    "/generations": async (request: Request) => {
      const unsupportedParams = ['size', 'width', 'height'];
      const bodyKeys = Object.keys(request.body);
      const foundUnsupported = unsupportedParams.filter(param => bodyKeys.includes(param));

      if (foundUnsupported.length > 0) {
        throw new Error(`不支持的参数: ${foundUnsupported.join(', ')}。请使用 ratio 和 resolution 参数控制图像尺寸。`);
      }

      request
        .validate("body.model", v => _.isUndefined(v) || _.isString(v))
        .validate("body.prompt", _.isString)
        .validate("body.negative_prompt", v => _.isUndefined(v) || _.isString(v))
        .validate("body.ratio", v => _.isUndefined(v) || _.isString(v))
        .validate("body.resolution", v => _.isUndefined(v) || _.isString(v))
        .validate("body.sample_strength", v => _.isUndefined(v) || _.isFinite(v))
        .validate("body.response_format", v => _.isUndefined(v) || _.isString(v))
        .validate("headers.authorization", _.isString);

      const tokens = tokenSplit(request.headers.authorization);
      const token = _.sample(tokens);
      const {
        model,
        prompt,
        negative_prompt: negativePrompt,
        ratio,
        resolution,
        sample_strength: sampleStrength,
        response_format,
      } = request.body;

      const responseFormat = _.defaultTo(response_format, "url");
      const imageUrls = await generateImages(model, prompt, {
        ratio,
        resolution,
        sampleStrength,
        negativePrompt,
      }, token);
      let data = [];
      if (responseFormat == "b64_json") {
        data = (
          await Promise.all(imageUrls.map((url) => util.fetchFileBASE64(url)))
        ).map((b64) => ({ b64_json: b64 }));
      } else {
        data = imageUrls.map((url) => ({
          url,
        }));
      }
      return {
        created: util.unixTimestamp(),
        data,
      };
    },
    
    "/compositions": async (request: Request) => {
      const unsupportedParams = ['size', 'width', 'height'];
      const bodyKeys = Object.keys(request.body);
      const foundUnsupported = unsupportedParams.filter(param => bodyKeys.includes(param));

      if (foundUnsupported.length > 0) {
        throw new Error(`不支持的参数: ${foundUnsupported.join(', ')}。请使用 ratio 和 resolution 参数控制图像尺寸。`);
      }

      const contentType = request.headers['content-type'] || '';
      const isMultiPart = contentType.startsWith('multipart/form-data');

      if (isMultiPart) {
        request
          .validate("body.model", v => _.isUndefined(v) || _.isString(v))
          .validate("body.prompt", _.isString)
          .validate("body.negative_prompt", v => _.isUndefined(v) || _.isString(v))
          .validate("body.ratio", v => _.isUndefined(v) || _.isString(v))
          .validate("body.resolution", v => _.isUndefined(v) || _.isString(v))
          .validate("body.sample_strength", v => _.isUndefined(v) || (typeof v === 'string' && !isNaN(parseFloat(v))) || _.isFinite(v))
          .validate("body.response_format", v => _.isUndefined(v) || _.isString(v))
          .validate("headers.authorization", _.isString);
      } else {
        request
          .validate("body.model", v => _.isUndefined(v) || _.isString(v))
          .validate("body.prompt", _.isString)
          .validate("body.images", _.isArray)
          .validate("body.negative_prompt", v => _.isUndefined(v) || _.isString(v))
          .validate("body.ratio", v => _.isUndefined(v) || _.isString(v))
          .validate("body.resolution", v => _.isUndefined(v) || _.isString(v))
          .validate("body.sample_strength", v => _.isUndefined(v) || _.isFinite(v))
          .validate("body.response_format", v => _.isUndefined(v) || _.isString(v))
          .validate("headers.authorization", _.isString);
      }

      let images: (string | Buffer)[] = [];
      if (isMultiPart) {
        const files = request.files?.images;
        if (!files) {
          throw new Error("在form-data中缺少 'images' 字段");
        }
        const imageFiles = Array.isArray(files) ? files : [files];
        if (imageFiles.length === 0) {
          throw new Error("至少需要提供1张输入图片");
        }
        if (imageFiles.length > 10) {
          throw new Error("最多支持10张输入图片");
        }
        images = imageFiles.map(file => fs.readFileSync(file.filepath));
      } else {
        const bodyImages = request.body.images;
        if (!bodyImages || bodyImages.length === 0) {
          throw new Error("至少需要提供1张输入图片");
        }
        if (bodyImages.length > 10) {
          throw new Error("最多支持10张输入图片");
        }
        bodyImages.forEach((image: any, index: number) => {
          if (!_.isString(image) && !_.isObject(image)) {
            throw new Error(`图片 ${index + 1} 格式不正确：应为URL字符串或包含url字段的对象`);
          }
          if (_.isObject(image) && !image.url) {
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
        sample_strength: sampleStrength,
        response_format,
      } = request.body;

      // 如果是 multipart/form-data，需要将字符串转换为数字
      const finalSampleStrength = isMultiPart && typeof sampleStrength === 'string'
        ? parseFloat(sampleStrength)
        : sampleStrength;

      const responseFormat = _.defaultTo(response_format, "url");
      const resultUrls = await generateImageComposition(model, prompt, images, {
        ratio,
        resolution,
        sampleStrength: finalSampleStrength,
        negativePrompt,
      }, token);

      let data = [];
      if (responseFormat == "b64_json") {
        data = (
          await Promise.all(resultUrls.map((url) => util.fetchFileBASE64(url)))
        ).map((b64) => ({ b64_json: b64 }));
      } else {
        data = resultUrls.map((url) => ({
          url,
        }));
      }

      return {
        created: util.unixTimestamp(),
        data,
        input_images: images.length,
        composition_type: "multi_image_synthesis",
      };
    },

    "/edits": async (request: Request) => {
      // 检查不支持的 OpenAI 参数
      const unsupportedParams = ['width', 'height'];
      const bodyKeys = Object.keys(request.body);
      const foundUnsupported = unsupportedParams.filter(param => bodyKeys.includes(param));

      if (foundUnsupported.length > 0) {
        throw new Error(`不支持的参数: ${foundUnsupported.join(', ')}。请使用 size 参数控制图像尺寸。`);
      }

      const contentType = request.headers['content-type'] || '';
      const isMultiPart = contentType.startsWith('multipart/form-data');

      if (isMultiPart) {
        // Multipart form data 处理
        // 兼容部分客户端的 prompt 重复字段或数组情况，先做归一化
        const rawBody: any = request.body || {};
        const rawPrompt = rawBody.prompt ?? rawBody['prompt[]'] ?? rawBody['prompt'];
        if (!_.isUndefined(rawPrompt)) {
          request.body.prompt = Array.isArray(rawPrompt) ? rawPrompt.filter(_.isString).join(' ') : rawPrompt;
        }
        request
          .validate("body.model", v => _.isUndefined(v) || _.isString(v))
          // 允许 prompt 为字符串或字符串数组（部分客户端会重复字段导致解析为数组）
          .validate("body.prompt", v => _.isString(v) || (_.isArray(v) && v.every(_.isString)))
          .validate("headers.authorization", _.isString);

        // 提取 image[] 数组
        let images: (string | Buffer)[] = [];
        const imageFiles = (request.files && (request.files as any).image)
          || (request.files && (request.files as any)['image[]'])
          || (request.files && (request.files as any).images)
          || (request.files && (request.files as any)['images[]']);
        if (!imageFiles && false) {
          throw new Error("缺少必需的 'image' 参数");
        }
        // 回退：当未提供文件字段时，尝试从表单 URL 字段读取图片
        if (!imageFiles) {
          const urlField = rawBody.image ?? rawBody['image[]'] ?? rawBody.images ?? rawBody['images[]'];
          if (_.isUndefined(urlField)) {
            throw new Error("缺少必需的 'image' 参数（支持上传文件或表单 URL 字段）");
          }
          const urlList: any[] = Array.isArray(urlField) ? urlField : [urlField];
          const strUrls = urlList
            .map((v) => (typeof v === 'string' ? v : null))
            .filter((v): v is string => !!v && v.trim().length > 0);
          if (strUrls.length === 0) {
            throw new Error("image 参数必须是有效的 URL 字符串或字符串数组");
          }
          images = strUrls;
        }

        if (imageFiles) {
        const imageArray = Array.isArray(imageFiles) ? imageFiles : [imageFiles];
        if (imageArray.length === 0) {
          throw new Error("至少需要提供1张图片");
        }

        images = imageArray.map(file => fs.readFileSync(file.filepath));
        }

        // 获取其他参数
        const {
          model,
          prompt,
          size,
          quality,
          negative_prompt,
          sample_strength,
          response_format,
        } = request.body;

        // 规范化 prompt 为字符串
        const normalizedPrompt = Array.isArray(prompt) ? prompt.join(' ') : prompt;

        // 参数映射
        const internalParams = mapOpenAIParamsToInternal({
          model,
          prompt: normalizedPrompt,
          size,
          quality,
          negative_prompt,
          sample_strength: typeof sample_strength === 'string' ? parseFloat(sample_strength) : sample_strength,
          response_format,
          images // 这里传入的 images 实际上不会被使用，因为我们已经有处理过的图片数组
        });

        const tokens = tokenSplit(request.headers.authorization);
        const token = _.sample(tokens);

        const responseFormat = internalParams.responseFormat;
        const resultUrls = await generateImageEdits(internalParams.model, internalParams.prompt, images, {
          ratio: internalParams.ratio,
          resolution: internalParams.resolution,
          sampleStrength: internalParams.sampleStrength,
          negativePrompt: request.body.negative_prompt || "", // 保持原始 negative_prompt
        }, token);

        return await formatOpenAIResponse(resultUrls, responseFormat, util.unixTimestamp());

      } else {
        // JSON 数据处理
        request
          .validate("body.model", v => _.isUndefined(v) || _.isString(v))
          // 允许 prompt 为字符串或字符串数组
          .validate("body.prompt", v => _.isString(v) || (_.isArray(v) && v.every(_.isString)))
          .validate("headers.authorization", _.isString);

        const {
          model,
          prompt,
          image,
          size,
          quality,
          negative_prompt,
          sample_strength,
          response_format,
        } = request.body;

        // 规范化 prompt 为字符串
        const normalizedPrompt = Array.isArray(prompt) ? prompt.join(' ') : prompt;

        // 检查 image 参数是否为空或未定义
        if (_.isUndefined(image)) {
          throw new Error("缺少必需的 'image' 参数");
        }

        // 处理 image 参数（支持单个图片或数组）
        let images: string[] = [];
        if (Array.isArray(image)) {
          images = image;
        } else if (typeof image === 'string') {
          images = [image];
        } else {
          throw new Error("image 参数必须是字符串或字符串数组");
        }

        if (images.length === 0) {
          throw new Error("至少需要提供1张图片");
        }

        // 参数映射
        const internalParams = mapOpenAIParamsToInternal({
          model,
          prompt: normalizedPrompt,
          size,
          quality,
          negative_prompt,
          sample_strength,
          response_format
        });

        const tokens = tokenSplit(request.headers.authorization);
        const token = _.sample(tokens);

        const responseFormat = internalParams.responseFormat;
        const resultUrls = await generateImageEdits(internalParams.model, internalParams.prompt, images, {
          ratio: internalParams.ratio,
          resolution: internalParams.resolution,
          sampleStrength: internalParams.sampleStrength,
          negativePrompt: negative_prompt || "",
        }, token);

        return await formatOpenAIResponse(resultUrls, responseFormat, util.unixTimestamp());
      }
    },
  },
};
