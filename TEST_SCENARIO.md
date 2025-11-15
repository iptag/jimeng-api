# Test Scenario for Image-to-Image Routing Fix

## Issue
User reported error when sending a chat completion request with both text and images:
```
[error] 即梦API请求失败: ret=1002, errmsg=common error
```

## Test Case

### Request Example
```bash
curl -X POST http://localhost:5100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "jimeng-4.0",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "更换背景和构图，把文字替换成\"你好呀\""
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

### Expected Behavior (AFTER FIX)

1. **Routing Decision**: System should detect this as `image-to-image` request
2. **Log Output**:
   ```
   [info] 消息解析结果: 文本长度=27, 图片数量=1
   [info] 图片类型: base64
   [info] 智能路由请求类型: image-to-image, 提示词长度: 27, 图片数量: 1
   [info] 检测到图片输入，图片类型: base64
   [info] 开始图生图，模型: jimeng-4.0, 图片数量: 1
   ```

3. **API Call**: System should call Jimeng API with:
   - `generate_type: "blend"` (NOT "generate")
   - Images uploaded separately
   - Prompt as simple string: "##更换背景和构图，把文字替换成\"你好呀\""

4. **Response**: Successful image generation with modified image

### Error Cases Caught by Fix

#### Case 1: Non-string prompt passed to text-to-image
**Before**: Would serialize array/object into JSON, causing API error
**After**: Immediate validation error with clear message

#### Case 2: hasImages=true but images array is empty
**Before**: Would route to image-to-image but fail with confusing error
**After**: Immediate validation error: "检测到图片标记但无法提取图片"

#### Case 3: Image-only request (no text)
**Before**: Would succeed but result might be poor quality
**After**: Warning logged: "检测到图片但没有提取到文本内容"

## Verification Checklist

- [ ] Text-only request → routes to text-to-image (generate_type: "generate")
- [ ] Text + image request → routes to image-to-image (generate_type: "blend")
- [ ] Image-only request → routes to image-to-image with warning
- [ ] Invalid prompt type → clear error message
- [ ] Logs show routing decision clearly
- [ ] No more "ret=1002, common error" for valid multimodal requests

## Key Code Changes

1. **chat.ts**: Added String() wrapper and validation checks
2. **images.ts**: Added type validation in both text-to-image and image-to-image functions
3. **message-parser.ts**: Added warning for image-without-text cases
4. **All**: Enhanced logging for debugging routing decisions

## Notes

The original error (ret=1002) was likely caused by:
- Malformed prompt format being sent to Jimeng API
- Using text-to-image endpoint when image-to-image was needed
- Missing validation allowed bad data to reach the API

The fix adds multiple layers of validation to catch issues early and provide clear error messages.
