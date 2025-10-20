import _ from 'lodash'

import Request from '@/lib/request/Request.ts'
import {
  generateImages,
  generateImageComposition,
} from '@/api/controllers/images.ts'
import { tokenSplit } from '@/api/controllers/core.ts'
import { RESOLUTION_OPTIONS } from '@/api/consts/common.ts'
import util from '@/lib/util.ts'

export default {
  prefix: '/v1/images',

  post: {
    '/generations': async (request: Request) => {
      // 检查是否包含不支持的参数
      const unsupportedParams = ['size', 'width', 'height']
      const bodyKeys = Object.keys(request.body)
      const foundUnsupported = unsupportedParams.filter((param) =>
        bodyKeys.includes(param)
      )

      if (foundUnsupported.length > 0) {
        throw new Error(
          `不支持的参数: ${foundUnsupported.join(
            ', '
          )}。请使用 ratio 和 resolution 参数控制图像尺寸。`
        )
      }

      request
        .validate('body.model', (v) => _.isUndefined(v) || _.isString(v))
        .validate('body.prompt', _.isString)
        .validate(
          'body.negative_prompt',
          (v) => _.isUndefined(v) || _.isString(v)
        )
        .validate('body.ratio', (v) => _.isUndefined(v) || _.isString(v))
        .validate('body.resolution', (v) => _.isUndefined(v) || _.isString(v))
        .validate(
          'body.sample_strength',
          (v) => _.isUndefined(v) || _.isFinite(v)
        )
        .validate(
          'body.response_format',
          (v) => _.isUndefined(v) || _.isString(v)
        )
        .validate('headers.authorization', _.isString)
      // refresh_token切分
      const tokens = tokenSplit(request.headers.authorization)
      // 随机挑选一个refresh_token
      const token = _.sample(tokens)
      const {
        model,
        prompt,
        negative_prompt: negativePrompt,
        ratio,
        resolution,
        sample_strength: sampleStrength,
        response_format,
      } = request.body

      // 解析尺寸
      const responseFormat = _.defaultTo(response_format, 'url')
      const imageUrls = await generateImages(
        model,
        prompt,
        {
          ratio,
          resolution,
          sampleStrength,
          negativePrompt,
        },
        token
      )
      let data = []
      if (responseFormat == 'b64_json') {
        data = (
          await Promise.all(imageUrls.map((url) => util.fetchFileBASE64(url)))
        ).map((b64) => ({ b64_json: b64 }))
      } else {
        data = imageUrls.map((url) => ({
          url,
        }))
      }
      return {
        created: util.unixTimestamp(),
        data,
      }
    },

    // 新增图片合成路由
    '/compositions': async (request: Request) => {
      // 检查是否包含不支持的参数
      const unsupportedParams = ['size', 'width', 'height']
      const bodyKeys = Object.keys(request.body)
      const foundUnsupported = unsupportedParams.filter((param) =>
        bodyKeys.includes(param)
      )

      if (foundUnsupported.length > 0) {
        throw new Error(
          `不支持的参数: ${foundUnsupported.join(
            ', '
          )}。请使用 ratio 和 resolution 参数控制图像尺寸。`
        )
      }

      request
        .validate('body.model', (v) => _.isUndefined(v) || _.isString(v))
        .validate('body.prompt', _.isString)
        .validate('body.images', _.isArray)
        .validate(
          'body.negative_prompt',
          (v) => _.isUndefined(v) || _.isString(v)
        )
        .validate('body.ratio', (v) => _.isUndefined(v) || _.isString(v))
        .validate('body.resolution', (v) => _.isUndefined(v) || _.isString(v))
        .validate(
          'body.sample_strength',
          (v) => _.isUndefined(v) || _.isFinite(v)
        )
        .validate(
          'body.response_format',
          (v) => _.isUndefined(v) || _.isString(v)
        )
        .validate('headers.authorization', _.isString)

      // 验证图片数组
      const { images } = request.body
      if (!images || images.length === 0) {
        throw new Error('至少需要提供1张输入图片')
      }
      if (images.length > 10) {
        throw new Error('最多支持10张输入图片')
      }

      // 验证每个图片元素
      images.forEach((image, index) => {
        if (!_.isString(image) && !_.isObject(image)) {
          throw new Error(
            `图片 ${index + 1} 格式不正确：应为URL字符串或包含url字段的对象`
          )
        }
        if (_.isObject(image) && !image.url) {
          throw new Error(`图片 ${index + 1} 缺少url字段`)
        }
      })

      // refresh_token切分
      const tokens = tokenSplit(request.headers.authorization)
      // 随机挑选一个refresh_token
      const token = _.sample(tokens)

      const {
        model,
        prompt,
        negative_prompt: negativePrompt,
        ratio,
        resolution,
        sample_strength: sampleStrength,
        response_format,
      } = request.body

      // 解析尺寸
      const responseFormat = _.defaultTo(response_format, "url");
      const resultUrls = await generateImageComposition(model, prompt, images, {
        ratio,
        resolution,
        sampleStrength,
        negativePrompt,
      }, token);

      let data = []
      if (responseFormat == 'b64_json') {
        data = (
          await Promise.all(resultUrls.map((url) => util.fetchFileBASE64(url)))
        ).map((b64) => ({ b64_json: b64 }))
      } else {
        data = resultUrls.map((url) => ({
          url,
        }))
      }

      return {
        created: util.unixTimestamp(),
        data,
        input_images: images.length,
        composition_type: "multi_image_synthesis",
      };
    },
  },
}
