import _ from 'lodash';
import logger from '@/lib/logger.ts';

/**
 * OpenAI消息格式解析器
 * 从OpenAI格式的消息中提取文本、图片URL和base64图片
 */

export interface ParsedMessage {
  text: string;
  images: MessageImage[];
  hasImages: boolean;
}

export interface MessageImage {
  url?: string;
  base64?: string;
  type: 'url' | 'base64';
}

/**
 * 从base64字符串中提取实际的base64数据
 * 支持格式: data:image/jpeg;base64,xxx 或直接的base64字符串
 */
function extractBase64Data(base64String: string): string {
  const match = base64String.match(/^data:image\/[^;]+;base64,(.+)$/);
  if (match) {
    return match[1];
  }
  return base64String;
}

/**
 * 从base64字符串转换为Buffer
 */
export function base64ToBuffer(base64String: string): Buffer {
  const base64Data = extractBase64Data(base64String);
  return Buffer.from(base64Data, 'base64');
}

/**
 * 解析单个消息内容部分
 */
function isLikelyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith('//');
}

function addImage(images: MessageImage[], value?: string) {
  if (!value) return;
  if (value.startsWith('data:image/')) {
    images.push({ base64: value, type: 'base64' });
    return;
  }
  if (isLikelyUrl(value)) {
    images.push({ url: value, type: 'url' });
    return;
  }
  // 默认当作base64处理
  images.push({ base64: value, type: 'base64' });
}

function parseMessageContent(content: any): { text: string; images: MessageImage[] } {
  const text: string[] = [];
  const images: MessageImage[] = [];

  if (_.isString(content)) {
    // 简单的文本内容
    text.push(content);
  } else if (_.isArray(content)) {
    // OpenAI格式的多模态内容数组
    for (const part of content) {
      if ((part.type === 'text' || part.type === 'input_text') && part.text) {
        text.push(part.text);
      } else if ((part.type === 'image_url' || part.type === 'input_image') && part.image_url) {
        const imageUrl = _.isString(part.image_url) ? part.image_url : part.image_url.url;
        addImage(images, imageUrl);
      } else if (part.type === 'image' && part.url) {
        addImage(images, part.url);
      } else if (part.type === 'input_image' && part.image_base64) {
        addImage(images, part.image_base64);
      } else if (part.type === 'input_image' && part.image_bytes) {
        addImage(images, part.image_bytes);
      } else if (part.type === 'image_url' && part.b64_json) {
        addImage(images, part.b64_json);
      }
    }
  } else if (_.isObject(content)) {
    // 可能是单个内容对象
    if ((content.type === 'text' || content.type === 'input_text') && content.text) {
      text.push(content.text);
    } else if ((content.type === 'image_url' || content.type === 'input_image') && content.image_url) {
      const imageUrl = _.isString(content.image_url) ? content.image_url : content.image_url.url;
      addImage(images, imageUrl);
    } else if ((content.type === 'input_image' || content.type === 'image') && content.image_base64) {
      addImage(images, content.image_base64);
    } else if ((content.type === 'input_image' || content.type === 'image') && content.image_bytes) {
      addImage(images, content.image_bytes);
    } else if ((content.type === 'image_url' || content.type === 'image') && content.url) {
      addImage(images, content.url);
    } else if (content.b64_json) {
      addImage(images, content.b64_json);
    }
  }

  return {
    text: text.join('\n'),
    images
  };
}

/**
 * 解析OpenAI格式的消息数组
 * 提取文本内容和图片
 */
export function parseMessages(messages: any[]): ParsedMessage {
  if (!messages || messages.length === 0) {
    return {
      text: '',
      images: [],
      hasImages: false
    };
  }

  const allText: string[] = [];
  const allImages: MessageImage[] = [];

  // 遍历所有消息
  for (const message of messages) {
    if (!message || !message.content) {
      continue;
    }

    const { text, images } = parseMessageContent(message.content);
    
    if (text) {
      allText.push(text);
    }
    
    if (images.length > 0) {
      allImages.push(...images);
    }
  }

  const finalText = allText.join('\n').trim();
  const result = {
    text: finalText,
    images: allImages,
    hasImages: allImages.length > 0
  };

  logger.info(`消息解析结果: 文本长度=${result.text.length}, 图片数量=${result.images.length}`);
  if (result.hasImages) {
    logger.info(`图片类型: ${result.images.map(img => img.type).join(', ')}`);
  }
  if (result.hasImages && !finalText) {
    logger.warn('警告: 检测到图片但没有提取到文本内容，这可能导致生成结果不理想');
  }

  return result;
}

/**
 * 判断模型是否为视频模型
 */
export function isVideoModel(model?: string): boolean {
  if (!model) return false;
  return model.includes('video') || model.includes('jimeng-video');
}

/**
 * 智能判断请求类型
 * 返回: 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video'
 */
export function detectRequestType(model: string | undefined, hasImages: boolean): string {
  const isVideo = isVideoModel(model);
  
  if (isVideo) {
    return hasImages ? 'image-to-video' : 'text-to-video';
  } else {
    return hasImages ? 'image-to-image' : 'text-to-image';
  }
}
