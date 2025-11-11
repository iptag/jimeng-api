# Image-to-Image Routing Compatibility Fix

## Problem

When users sent requests to `/v1/chat/completions` with both text and images (multimodal content), the system was incorrectly routing to text-to-image generation instead of image-to-image generation. This caused API error 1002 "common error" because the format sent to the Jimeng API was incorrect.

### Error Symptoms
- User includes both text and images in chat completions request
- System logs show: `使用模型: jimeng-4.0 映射模型: high_aes_general_v40`
- API returns error: `ret=1002, errmsg=common error`
- The draft_content shows `generate_type: "generate"` instead of `generate_type: "blend"`

## Root Cause

The smart routing logic was correct, but there were potential edge cases where:
1. The prompt parameter could be passed as a non-string type (array/object) to generation functions
2. No validation existed to catch and prevent malformed prompts from being sent to the API
3. Limited logging made it difficult to debug routing decisions

## Changes Made

### 1. Enhanced Validation in `images.ts`

#### `generateImageComposition` (Image-to-Image)
- Added type validation for the `prompt` parameter to ensure it's always a string
- Added validation to ensure at least one image is provided
- Provides clear error messages when validation fails

#### `generateImagesInternal` (Text-to-Image)
- Added type validation for the `prompt` parameter to ensure it's always a string
- Prevents accidental passing of non-string types (like arrays or objects)
- Throws descriptive error directing users to use the image-to-image endpoint if needed

### 2. Improved Safety in `chat.ts`

#### Both `createCompletion` and `createCompletionStream`
- Added `String()` wrapper around finalPrompt to ensure it's always a string type
- Added validation check: if `hasImages` is true but `images.length` is 0, throw an error
- This catches potential bugs in the message parsing logic
- Enhanced logging to show image types when images are detected

### 3. Enhanced Message Parser in `message-parser.ts`

- Added warning log when images are detected but no text content is extracted
- This helps identify cases where users send image-only requests
- Better variable naming for clarity (`finalText`)

### 4. Improved Logging

- Added detailed logging when images are detected:
  - Shows image types (url or base64)
  - Shows image count
  - Shows request type routing decision
- Both sync and stream handlers now have consistent logging
- Helps debug routing decisions and identify issues quickly

## How It Works Now

When a user sends a request with both text and images:

1. **Message Parsing**: `parseMessages()` extracts text and images separately
   - Returns: `{ text: string, images: Array, hasImages: boolean }`

2. **Type Safety**: `finalPrompt` is ensured to be a string via `String()` wrapper

3. **Routing Detection**: `detectRequestType()` determines the appropriate endpoint
   - If `hasImages === true` and not a video model → `'image-to-image'`
   - Otherwise → `'text-to-image'`

4. **Validation**: Before calling generation functions, validates:
   - Prompt is a string type
   - For image-to-image: images array is not empty
   - For both: parameters match expected types

5. **Generation**: Routes to the correct function
   - **Text-to-Image**: Uses `generate_type: "generate"` with text prompt only
   - **Image-to-Image**: Uses `generate_type: "blend"` with uploaded images

## Benefits

1. **Prevents API Errors**: Catches malformed requests before sending to Jimeng API
2. **Clear Error Messages**: Users get descriptive errors explaining what went wrong
3. **Better Debugging**: Enhanced logging makes it easy to track routing decisions
4. **Type Safety**: Ensures prompts are always strings, preventing serialization issues
5. **Consistent Behavior**: Both sync and stream handlers have the same validation and logging

## Testing Recommendations

Test the following scenarios:

1. **Text Only**: Should route to text-to-image
   ```json
   {
     "messages": [
       { "role": "user", "content": "生成一张猫的图片" }
     ]
   }
   ```

2. **Text with Image**: Should route to image-to-image
   ```json
   {
     "messages": [
       {
         "role": "user",
         "content": [
           { "type": "text", "text": "更换背景和构图" },
           { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
         ]
       }
     ]
   }
   ```

3. **Image Only**: Should route to image-to-image with warning about missing text
   ```json
   {
     "messages": [
       {
         "role": "user",
         "content": [
           { "type": "image_url", "image_url": { "url": "https://example.com/image.jpg" } }
         ]
       }
     ]
   }
   ```

## Expected Log Output

For a text-with-image request, you should see:
```
[info] 智能路由请求类型: image-to-image, 提示词长度: 20, 图片数量: 1
[info] 检测到图片输入，图片类型: base64
[info] 开始图生图，模型: jimeng-4.0, 图片数量: 1
```

This confirms the routing is working correctly!
