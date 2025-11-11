# OpenAI Chat格式兼容说明

本项目现已完全兼容OpenAI的Chat格式，支持通过 `/v1/chat/completions` 接口完成文生图、图生图、文生视频、图生视频等全部功能。

## 特性

- ✅ 智能路由：根据消息内容和模型自动识别请求类型
- ✅ 多模态支持：支持文本、图片URL、Base64图片混合输入
- ✅ 流式和非流式输出
- ✅ 完整参数解析：ratio, resolution, duration, sample_strength, negative_prompt等

## 请求类型自动识别

系统会根据以下规则智能判断请求类型：

1. **文生视频** (text-to-video): 模型包含 `video` 关键字，且无图片输入
2. **图生视频** (image-to-video): 模型包含 `video` 关键字，且有图片输入
3. **图生图** (image-to-image): 非视频模型，且有图片输入
4. **文生图** (text-to-image): 非视频模型，且无图片输入

## API使用示例

### 1. 文生图 (Text-to-Image)

```bash
curl -X POST http://localhost:5100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d '{
    "model": "jimeng-4.0",
    "messages": [
      {
        "role": "user",
        "content": "一只可爱的猫咪，摄影风格"
      }
    ],
    "ratio": "16:9",
    "resolution": "2k",
    "sample_strength": 0.7,
    "negative_prompt": "模糊，低质量",
    "stream": false
  }'
```

### 2. 图生图 (Image-to-Image)

支持多种图片输入格式：

#### 方式1: 图片URL

```bash
curl -X POST http://localhost:5100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d '{
    "model": "jimeng-4.0",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "将这张图片改成梵高风格"
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://example.com/image.jpg"
            }
          }
        ]
      }
    ],
    "ratio": "1:1",
    "resolution": "2k",
    "sample_strength": 0.5
  }'
```

#### 方式2: Base64图片

```bash
curl -X POST http://localhost:5100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d '{
    "model": "jimeng-4.0",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "将这张图片改成油画风格"
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
            }
          }
        ]
      }
    ]
  }'
```

#### 方式3: 多张图片融合

```bash
curl -X POST http://localhost:5100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d '{
    "model": "jimeng-4.0",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "融合这两张图片的风格"
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://example.com/image1.jpg"
            }
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://example.com/image2.jpg"
            }
          }
        ]
      }
    ],
    "sample_strength": 0.6
  }'
```

### 3. 文生视频 (Text-to-Video)

```bash
curl -X POST http://localhost:5100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d '{
    "model": "jimeng-video-3.0",
    "messages": [
      {
        "role": "user",
        "content": "一只猫咪在花园里玩耍"
      }
    ],
    "ratio": "16:9",
    "resolution": "720p",
    "duration": 5
  }'
```

### 4. 图生视频 (Image-to-Video)

```bash
curl -X POST http://localhost:5100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d '{
    "model": "jimeng-video-3.0",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "让这张图片动起来，微风吹拂的效果"
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://example.com/image.jpg"
            }
          }
        ]
      }
    ],
    "ratio": "16:9",
    "resolution": "720p",
    "duration": 5
  }'
```

### 5. 流式输出

将 `stream` 参数设置为 `true` 即可启用流式输出：

```bash
curl -X POST http://localhost:5100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d '{
    "model": "jimeng-4.0",
    "messages": [
      {
        "role": "user",
        "content": "一只可爱的猫咪"
      }
    ],
    "stream": true
  }'
```

## 支持的消息格式

### OpenAI标准格式

```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "描述文本"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "图片URL或Base64"
      }
    }
  ]
}
```

### 简化文本格式

```json
{
  "role": "user",
  "content": "纯文本描述"
}
```

### 扩展格式

系统还支持以下扩展格式：

```json
{
  "role": "user",
  "content": [
    {
      "type": "input_text",
      "text": "文本内容"
    },
    {
      "type": "input_image",
      "image_url": "图片URL",
      "image_base64": "Base64图片数据",
      "image_bytes": "图片字节数据"
    }
  ]
}
```

## 支持的模型

### 图像模型
- `jimeng-4.0` (默认，推荐)
- `jimeng-2.1`
- `jimeng-2.0`
- `jimeng-1.4`
- `jimeng-1.0`
- `nanobanana` (国际版)

### 视频模型
- `jimeng-video-3.0` (默认，推荐)
- `jimeng-video-2.0`
- `jimeng-video-1.0`

## 支持的参数

| 参数 | 类型 | 说明 | 默认值 | 适用场景 |
|------|------|------|--------|----------|
| `model` | string | 模型名称 | `jimeng-4.0` | 全部 |
| `messages` | array | OpenAI格式消息数组 | 必填 | 全部 |
| `stream` | boolean | 是否流式输出 | `false` | 全部 |
| `ratio` | string | 宽高比 | `1:1` | 图片/视频 |
| `resolution` | string | 分辨率 | 图片: `2k`, 视频: `720p` | 图片/视频 |
| `sample_strength` | number | 采样强度 (0-1) | `0.5` | 图生图 |
| `negative_prompt` | string | 负向提示词 | `""` | 文生图/图生图 |
| `duration` | number | 视频时长(秒) | `5` | 视频 (5或10) |

### 支持的分辨率

**图片模型**:
- `1k`, `2k`, `4k`

**视频模型**:
- `720p`, `1080p`

### 支持的宽高比

**图片和视频**:
- `1:1` (正方形)
- `4:3` (横向)
- `3:4` (纵向)
- `16:9` (宽屏)
- `9:16` (竖屏)
- `3:2` (相机比例)
- `2:3` (相机比例竖屏)
- `21:9` (超宽屏)

## 响应格式

### 成功响应

```json
{
  "id": "chatcmpl-xxx",
  "model": "jimeng-4.0",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "![image_0](https://xxx.com/image0.jpg)\n![image_1](https://xxx.com/image1.jpg)\n"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 1,
    "completion_tokens": 1,
    "total_tokens": 2
  },
  "created": 1234567890
}
```

### 流式响应

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"🎨 图像生成中，请稍候..."},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":1,"delta":{"role":"assistant","content":"![image_0](https://xxx.com/image.jpg)\n"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":2,"delta":{"role":"assistant","content":""},"finish_reason":"stop"}]}

data: [DONE]
```

## 最佳实践

1. **图片输入限制**：图生图最多支持10张输入图片
2. **Base64图片**：建议使用图片URL而非Base64，以减少请求体积
3. **视频生成时长**：视频生成时间较长(1-2分钟)，建议使用流式输出获取进度
4. **采样强度**：`sample_strength` 越高，越接近原图；越低，创作自由度越大
5. **负向提示词**：使用 `negative_prompt` 可以排除不想要的元素
6. **模型选择**：`jimeng-4.0` 为最新模型，推荐优先使用

## 错误处理

系统会返回友好的错误信息：

```json
{
  "error": {
    "message": "错误描述",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

常见错误：
- 积分不足
- 图片上传失败
- 模型不支持
- 参数格式错误

## 与原有接口的对比

| 功能 | 原接口 | Chat接口 | 备注 |
|------|--------|---------|------|
| 文生图 | `/v1/images/generations` | `/v1/chat/completions` | 参数相同 |
| 图生图 | `/v1/images/compositions` | `/v1/chat/completions` | 自动识别 |
| 文生视频 | `/v1/videos/generations` | `/v1/chat/completions` | 自动识别 |
| 图生视频 | `/v1/videos/generations` | `/v1/chat/completions` | 自动识别 |

Chat接口的优势：
- 统一的接口格式
- 更简洁的调用方式
- 自动智能路由
- 完全兼容OpenAI格式
- 支持多轮对话上下文(仅使用最后一条user消息)

## 技术实现

### 消息解析

系统会自动解析OpenAI格式的消息：
1. 提取所有user角色的消息
2. 从消息中分离文本和图片
3. 支持多种图片格式（URL、Base64）

### 智能路由

根据以下规则进行路由：
```
if (model包含'video' || model包含'jimeng-video'):
    if (有图片输入):
        -> 图生视频
    else:
        -> 文生视频
else:
    if (有图片输入):
        -> 图生图
    else:
        -> 文生图
```

### 图片处理

- **URL图片**: 直接传递给后端API
- **Base64图片**: 转换为Buffer后上传
- **混合输入**: 支持URL和Base64混合使用

## 注意事项

1. 系统只使用最后一条user消息的内容进行生成
2. 多轮对话中，系统会自动提取最新的用户输入
3. 图片会从消息的content数组中提取，支持多张图片
4. 视频生成时，首张图片作为首帧，第二张图片作为尾帧
