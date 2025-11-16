---
name: jimeng-image-generator
description: Generate images using the Jimeng API based on text prompts. Use this skill when users request AI-generated images from the Jimeng (即梦AI) service, artwork, illustrations, or visual content creation. Supports text-to-image and image-to-image generation with customizable ratios and resolutions.
version: 1.0.0
dependencies: python>=3.7, requests>=2.28.0, Pillow>=9.0.0
---

# Jimeng Image Generator

## Overview

This skill enables image generation using a locally deployed Jimeng API service (Docker). It converts text prompts into high-quality images and automatically downloads them to the project's `/pic` folder. The skill supports text-to-image generation, image-to-image composition, customizable aspect ratios (1:1, 16:9, etc.), and multiple resolution levels (1k, 2k, 4k).

**API Endpoint**: `http://localhost:5100`

## When to Use This Skill

Use this skill when users request:
- "使用即梦生成图片 [描述]"
- "Generate an image using Jimeng: [description]"
- "Create artwork showing [scene/concept]"
- "Make an illustration of [subject]"
- "Generate a 4K image of [description]"
- "Transform this image to [style]" (image-to-image)
- Any request involving Jimeng AI image generation or visual content creation

## Quick Start

### Prerequisites

**IMPORTANT**: The Jimeng API must be running locally via Docker before using this skill.

**Region-specific prefixes**:
   - 国内站: Direct sessionid (e.g., `your_session_id`)
   - 美国站: Add `us-` prefix (e.g., `us-your_session_id`)
   - 香港站: Add `hk-` prefix (e.g., `hk-your_session_id`)
   - 日本站: Add `jp-` prefix (e.g., `jp-your_session_id`)
   - 新加坡站: Add `sg-` prefix (e.g., `sg-your_session_id`)

**Always ask the user for their Session ID before proceeding**, as the skill does not include a pre-configured credential.

Example prompt to user:
> "要使用即梦API生成图片,我需要您的Session ID。您可以从即梦网站(jimeng.jianying.com)的浏览器Cookie中获取 sessionid。
>
> 如果使用国际站,请在sessionid前添加对应前缀(us-/hk-/jp-/sg-)。
>
> 请提供您的 Session ID。"

### Basic Workflow

1. **Receive user request** for image generation
2. **Verify API availability** (check if Docker service is running)
3. **Request Session ID** from the user if not already provided
4. **Clarify requirements**:
   - Text prompt (文生图) or input images (图生图)
   - Model selection (jimeng-4.0, jimeng-3.1, etc.)
   - Aspect ratio (1:1, 16:9, 4:3, etc.)
   - Resolution (1k, 2k, 4k)
   - Intelligent ratio (auto-detect based on prompt keywords)
5. **Execute generation** using the `generate_image.py` script
6. **Report results** with file paths and display the generated images

## Image Generation Tasks

### Text-to-Image Generation

Generate images from text descriptions.

**Example user request:**
> "生成一张2K分辨率的16:9图片,内容是未来都市的日落景色,有飞行汽车"

**Script usage:**
```bash
python scripts/generate_image.py text \
    "futuristic city at sunset with flying cars" \
    --session-id "YOUR_SESSION_ID" \
    --model "jimeng-4.0" \
    --ratio "16:9" \
    --resolution "2k"
```

**Parameters:**
- `prompt` (required): Text description of the desired image
- `--session-id`: Jimeng session ID (required)
- `--model`: Model to use (default: `jimeng-4.0`)
  - Options: `jimeng-4.0`, `jimeng-3.1`, `jimeng-3.0`, `jimeng-2.1`, `jimeng-xl-pro`, `nanobanana` (international only)
- `--ratio`: Aspect ratio (default: `1:1`)
  - Options: `1:1`, `4:3`, `3:4`, `16:9`, `9:16`, `3:2`, `2:3`, `21:9`
- `--resolution`: Resolution level (default: `2k`)
  - Options: `1k`, `2k`, `4k`
- `--intelligent-ratio`: Enable smart ratio detection based on prompt keywords
- `--negative-prompt`: Negative prompt (elements to avoid)
- `--sample-strength`: Sampling strength (0.0-1.0)
- `--api-url`: Custom API URL (default: `http://localhost:5100`)
- `--output-dir`: Custom output directory (defaults to `project_root/pic`)

### Image-to-Image Composition

Transform or compose images based on text guidance.

**Example user request:**
> "把这张照片转换成油画风格,色彩鲜艳,笔触明显"

**Script usage:**
```bash
# Using local file
python scripts/generate_image.py image \
    "transform to oil painting style, vivid colors, visible brushstrokes" \
    --session-id "YOUR_SESSION_ID" \
    --images "/path/to/image.jpg" \
    --ratio "1:1" \
    --resolution "2k"

# Using image URL
python scripts/generate_image.py image \
    "anime style, cute cat" \
    --session-id "YOUR_SESSION_ID" \
    --images "https://example.com/cat.jpg" \
    --model "jimeng-4.0"

# Multiple images (up to 10)
python scripts/generate_image.py image \
    "merge these images into a cohesive scene" \
    --session-id "YOUR_SESSION_ID" \
    --images "image1.jpg" "image2.png" "image3.jpg"
```

**Parameters:**
- Same as text-to-image, plus:
- `--images`: One or more image paths or URLs (1-10 images)

**Supported formats**: JPG, PNG, WebP
**Size limit**: Recommended <10MB per image

### Intelligent Ratio Detection

Use `--intelligent-ratio` to automatically select the best aspect ratio based on prompt keywords.

**Example:**
```bash
python scripts/generate_image.py text \
    "奔跑的狮子,竖屏" \
    --session-id "YOUR_SESSION_ID" \
    --resolution "2k" \
    --intelligent-ratio
```

### Resolution Options

| Resolution | Ratio | Dimensions |
|------------|-------|------------|
| **1k** | 1:1 | 1328×1328 |
|  | 16:9 | 1664×936 |
| **2k** (default) | 1:1 | 2048×2048 |
|  | 16:9 | 2560×1440 |
|  | 4:3 | 2304×1728 |
| **4k** | 1:1 | 4096×4096 |
|  | 16:9 | 5120×2880 |
|  | 21:9 | 6048×2592 |

## Script Details

### Location
`scripts/generate_image.py`

### Key Features
- Automatic project root detection (looks for `.git`, `.claude`, etc.)
- Creates `/pic` folder if it doesn't exist
- Timestamps filenames to prevent overwrites (format: `jimeng_YYYYMMDD_HHMMSS_N.png`)
- Automatic WebP to PNG conversion for maximum compatibility
- Downloads all generated images from API response
- Supports both text-to-image and image-to-image modes
- Handles multipart/form-data for local file uploads
- Error handling for API calls and downloads
- Prints generation statistics

### Output Format
- Images are saved to: `{project_root}/pic/jimeng_{timestamp}_{index}.png`
- **All images are automatically converted to PNG format** (including WebP sources)
- Each API call generates several variations

### Requirements
The script requires:
```bash
pip install requests Pillow
```

**Note**: Pillow is required for WebP to PNG conversion. If not installed, WebP images will be saved as-is.

## Workflow Decision Tree

```
User requests image generation
    ↓
Is Jimeng API running at localhost:5100?
    ├─ No → Instruct user to start Docker service
    └─ Yes → Continue
    ↓
Do we have Session ID?
    ├─ No → Request Session ID from user → Store for session
    └─ Yes → Continue
    ↓
Text-to-Image or Image-to-Image?
    ├─ Text-to-Image
    │   └─ Run: generate_image.py text "prompt" --session-id ID --ratio RATIO --resolution RES
    └─ Image-to-Image
        └─ Run: generate_image.py image "prompt" --session-id ID --images PATH1 [PATH2...]
    ↓
Script executes:
    1. Calls Jimeng API (文生图 or 图生图)
    2. Receives image URLs
    3. Downloads all images to /pic folder
    4. Reports file paths
    ↓
Inform user of results
    ├─ Success → Show file paths, display generated images
    └─ Failure → Report error, suggest troubleshooting
```

## Troubleshooting

### Common Issues

**"Session ID required"**
- Ensure the user has provided their sessionid from 即梦/Dreamina
- Verify correct region prefix (us-/hk-/jp-/sg- for international sites)

**"Invalid session or authentication failed"**
- Session ID may have expired
- Request user to refresh their browser and get a new sessionid
- Verify the sessionid is copied correctly (no extra spaces)

**"Error downloading image"**
- Check network connectivity
- Verify output directory is writable
- Image URLs may have expired (retry generation)

**"Model not supported"**
- `nanobanana` only works with international sites (us-/hk-/jp-/sg- prefix)
- `jimeng-3.1` and `jimeng-2.1` only work with domestic sites

## Best Practices

1. **Request Session ID early** - Ask for it upfront if not already provided
2. **Clarify generation mode** - Determine if user wants text-to-image or image-to-image
3. **Optimize prompts** - Help users craft detailed, descriptive prompts
   - Include: subject, style, lighting, colors, composition, details
4. **Choose appropriate resolution** - Balance quality vs generation time
   - 1k: Fast, suitable for previews
   - 2k: Default, good balance
   - 4k: High quality, slower generation
5. **Use intelligent ratio when applicable** - Enable when prompt contains orientation hints
6. **Inform about output location** - Always tell users where images are saved
7. **Display generated images** - After download, show the images to the user for review
8. **Handle all variations** - API returns image-urls; download and present all of them

## Advanced Prompt Engineering

For high-quality results, guide users to provide detailed prompts:

**Well-crafted prompt example**:
```
"赛博朋克风格的未来都市街景,霓虹灯闪烁,雨后湿润的地面反射光线,
16:9横屏构图,电影感,景深效果,高细节渲染,蓝紫色调为主,
夜景氛围,光线追踪,超现实主义"
```

**Prompt structure**:
1. **主题** (Subject): 核心内容
2. **风格** (Style): 艺术风格、渲染技术
3. **光照** (Lighting): 光线条件、氛围
4. **色彩** (Color): 色调、色彩方案
5. **构图** (Composition): 视角、画面比例
6. **细节** (Details): 特定元素、质感

## Example Interactions

**Example 1: Simple text-to-image**
```
User: "用即梦生成一张日落山景图"
Claude: "我来帮您使用即梦API生成图片。首先需要确认您的Session ID..."
[User provides sessionid]
Claude: [Executes generate_image.py text mode]
Claude: "✅ 成功生成4张图片!
- /project/pic/jimeng_20250116_153022_1.png
- /project/pic/jimeng_20250116_153022_2.png
- /project/pic/jimeng_20250116_153022_3.png
- /project/pic/jimeng_20250116_153022_4.png"
[Displays images]
```

**Example 2: High-resolution with custom ratio**
```
User: "生成4K分辨率的21:9超宽屏壮丽山水风景"
Claude: [Executes with --resolution "4k" --ratio "21:9"]
Claude: "✅ 已生成4K超宽屏图片(6048×2592):
- 已保存到 /project/pic/jimeng_20250116_154530_1.png 等4张图片"
```

**Example 3: Image-to-image transformation**
```
User: "把这张猫咪照片转成动漫风格"
Claude: "请提供猫咪照片的路径或URL"
[User provides image path]
Claude: [Executes image mode with --images]
Claude: "✅ 图片风格转换完成,生成了4个动漫风格版本:
- /project/pic/jimeng_20250116_160015_1.png
- ..."
```

**Example 4: Intelligent ratio**
```
User: "生成一张竖屏手机壁纸,星空主题"
Claude: [Executes with --intelligent-ratio, auto-detects 9:16]
Claude: "✅ 已根据'竖屏'关键词自动选择9:16比例,生成星空壁纸4张"
```

## API Response Format

The Jimeng API returns image variations per request:

```json
{
    "created": 1763260188,
    "data": [
        {"url": "https://p3-dreamina-sign.byteimg.com/...image1.png"},
        {"url": "https://p26-dreamina-sign.byteimg.com/...image2.png"},
        {"url": "https://p26-dreamina-sign.byteimg.com/...image3.png"},
        {"url": "https://p3-dreamina-sign.byteimg.com/...image4.png"}
    ]
}
```

All images are automatically downloaded and saved with sequential numbering.

## Security Notes

- ⚠️ **Never hardcode Session IDs** in scripts or skill files
- ⚠️ Session IDs are user-specific credentials; treat them as passwords
- ⚠️ Ensure the local API endpoint is not exposed publicly
- ⚠️ Image URLs from API responses may expire; download immediately
