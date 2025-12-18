# Jimeng API

[中文文档](README.CN.md)

🎨 **Free AI Image and Video Generation API Service** - Based on reverse engineering of Jimeng AI (China site) and Dreamina (international site).

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/) [![Docker](https://img.shields.io/badge/Docker-Supported-blue.svg)](https://www.docker.com/) [![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)

## ✨ Features

- 🎨 **AI Image Generation**: Supports multiple models and resolutions (default 2K, supports 4K, 1K).
- 🖼️ **Image-to-Image Synthesis**: Supports local images or image URLs.
- 🎬 **AI Video Generation**: Supports text-to-video generation, and adds local image upload for image-to-video on the China site.
- 🌐 **International Site Support**: Added support for text-to-image and image-to-image APIs on Dreamina international sites. Open an issue if you run into problems.
- 🔄 **Smart Polling**: Adaptive polling mechanism to optimize generation efficiency.
- 🛡️ **Unified Exception Handling**: Comprehensive error handling and retry mechanism.
- 📊 **Detailed Logs**: Structured logging for easy debugging.
- 🐳 **Docker Support**: Containerized deployment, ready to use out of the box.
- ⚙️ **Log Level Control**: Dynamically adjust log output level through configuration files.

## ⚠ Risk Warning

- This project is for research and educational purposes only. It does not accept any financial donations or transactions!
- For personal use and research only. Avoid putting pressure on the official servers. Abuse may result in account bans or legal action.
- For personal use and research only. Avoid putting pressure on the official servers. Abuse may result in account bans or legal action.
- For personal use and research only. Avoid putting pressure on the official servers. Abuse may result in account bans or legal action.

## ✨ New Feature Highlights

### 📐 `ratio` and `resolution` Parameter Support

Image dimensions are now controlled by the `ratio` and `resolution` parameters, giving you more flexibility. The default `resolution` is set to `2k`.

```bash
curl -X POST http://localhost:5100/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d \
    "{\"model\": \"jimeng-4.5\", \"prompt\": \"A beautiful girl, film-like feel\", \"ratio\": \"4:3\", \"resolution\": \"2k\"}"
```

**Supported resolutions**: `1k`, `2k`, `4k`

**Supported ratios**: `1:1`, `4:3`, `3:4`, `16:9`, `9:16`, `3:2`, `2:3`, `21:9`

## 🚀 Quick Start

### Getting `sessionid`
- Getting your `sessionid` works the same way on both the China site (Jimeng) and international sites (Dreamina) — see the screenshot below.
> **Note 1**: The API endpoints are the same for the China site and international sites, but use different prefixes:
> - **China site**: Use the `sessionid` directly, e.g., `Bearer your_session_id`
> - **US site**: Add **us-** prefix, e.g., `Bearer us-your_session_id`
> - **Hong Kong site**: Add **hk-** prefix, e.g., `Bearer hk-your_session_id`
> - **Japan site**: Add **jp-** prefix, e.g., `Bearer jp-your_session_id`
> - **Singapore site**: Add **sg-** prefix, e.g., `Bearer sg-your_session_id`
>
> **Note 2**: The China site and international sites now support both *text-to-image* and *image-to-image*. The nanobanana and nanobananapro models are available on international sites.
>
> **Note 3**: Resolution rules when using the nanobanana model on international sites:
> - **US site (us-)**: Images are fixed at **1024x1024** with **2k** resolution, ignoring user-provided ratio and resolution parameters
> - **Hong Kong/Japan/Singapore sites (hk-/jp-/sg-)**: Fixed **1k** resolution, but supports custom `ratio` values (e.g., 16:9, 4:3, etc.)

![](https://github.com/iptag/jimeng-api/blob/main/get_sessionid.png)

### Environment Requirements

- Node.js 18+
- npm or yarn
- Docker (optional)

### Installation and Deployment

#### Method 1: Pull and Update the Docker Image (Recommended)

**Pull command**
```bash
docker run -d \
  --name jimeng-api \
  -p 5100:5100 \
  --restart unless-stopped \
  ghcr.io/iptag/jimeng-api:latest
```

**Update command**
```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  --run-once jimeng-api
```

#### Method 2: Direct Run

```bash
# Clone the project
git clone <repository-url>
cd jimeng-api

# Install dependencies
npm install

# Build files
npm run build

# Start the service
npm run dev
```

#### Method 3: Docker Deployment (recommended)

##### 🚀 Quick Start
```bash
# Using docker-compose
docker-compose up -d

# Or build and run manually
docker build -t jimeng-api .

docker run -d \
  --name jimeng-api \
  -p 5100:5100 \
  --restart unless-stopped \
  jimeng-api
```

##### 🔧 Common Commands
```bash
# Rebuild and start
docker-compose up -d --build

# View service logs
docker logs jimeng-api

# Stop service
docker-compose down

# Enter container for debugging
docker exec -it jimeng-api sh
```

##### 📊 Docker Image Features
- ✅ **Multi-stage build**: Optimized image size (170MB)
- ✅ **Non-root user**: Enhanced security (user:jimeng,)
- ✅ **Health check**: Automatic service status monitoring
- ✅ **Unified port**: Uses port 5100 both inside and outside the container
- ✅ **Log management**: Structured log output

### Configuration

#### `configs/dev/service.yml`
```yaml
name: jimeng-api
route: src/api/routes/index.ts
port: 5100
```

#### `configs/dev/system.yml`
```yaml
requestLog: true
debug: false
log_level: info # Log levels: error, warning, info (default), debug
```

## 🤖 Claude Code Skill

This project includes a dedicated Claude Code Skill for quick image generation using the Jimeng API directly within Claude Code conversations.

### Features

- 🎯 **Quick Generation**: Use Jimeng API to generate images directly in conversations
- 📁 **Auto-Save**: Generated images are automatically saved to the project's `/pic` directory
- 🔄 **Format Conversion**: Automatic WebP to PNG conversion
- 🎨 **Dual Modes**: Supports both text-to-image and image-to-image generation
- ⚙️ **Configurable**: Customizable ratio, resolution, model parameters, and more

### Installation

1. **Ensure the jimeng-api service is running**:
```bash
# Start the service with Docker
docker-compose up -d
# or
docker run -d --name jimeng-api -p 5100:5100 ghcr.io/iptag/jimeng-api:latest
```

2. **Copy the skill to Claude Code's skills directory**:
```bash
# Copy to user-level global skills directory
cp -r jimeng-api ~/.claude/skills/

# Or copy to project-level skills directory
cp -r jimeng-api ./.claude/skills/
```

3. **Install Python dependencies**:
```bash
pip install requests Pillow
```

### Usage Example

In Claude Code, simply use natural language:

```
User: "my sessionid is xxxxx，Generate a 2K 16:9 image of a futuristic city at sunset using Jimeng"

Claude: [Automatically invokes the skill, generates images, and saves to /pic directory]
```

For more details, see `jimeng-api/Skill.md`.

## 📖 API Documentation

### Text-to-Image

**POST** `/v1/images/generations`

**Request Parameters**:
- `model` (string, optional): The name of the model to use. Defaults to `jimeng-4.5` on all sites (China/US/HK/JP/SG).
- `prompt` (string): The text description of the image.
- `ratio` (string, optional): The aspect ratio of the image, defaults to `"1:1"`. Supported ratios: `1:1`, `4:3`, `3:4`, `16:9`, `9:16`, `3:2`, `2:3`, `21:9`. **Note**: When `intelligent_ratio` is `true`, this parameter will be ignored and the system will automatically infer the optimal ratio from the prompt.
- `resolution` (string, optional): The resolution level, defaults to `"2k"`. Supported resolutions: `1k`, `2k`, `4k`.
- `intelligent_ratio` (boolean, optional): Whether to enable intelligent ratio, defaults to `false`. **⚠️ This parameter only works for the jimeng-4.0/jimeng-4.1/jimeng-4.5 model; other models will ignore it.** When enabled, the system automatically infers the optimal image ratio from the prompt (e.g., "portrait" → 9:16, "landscape" → 16:9).
- `negative_prompt` (string, optional): Negative prompt.
- `sample_strength` (number, optional): Sampling strength (0.0-1.0).
- `response_format` (string, optional): Response format ("url"(default) or "b64_json").

```bash
# Default parameters (ratio: "1:1", resolution: "2k")
curl -X POST http://localhost:5100/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d \
    "{\"model\": \"jimeng-4.5\", \"prompt\": \"A cute little cat\"}"

# Example using 4K resolution
curl -X POST http://localhost:5100/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d \
    "{\"model\": \"jimeng-4.5\", \"prompt\": \"Magnificent landscape, ultra-high resolution\", \"ratio\": \"16:9\", \"resolution\": \"4k\"}"

# Example using intelligent ratio (system will infer 9:16 from "portrait")
curl -X POST http://localhost:5100/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d \
    "{\"model\": \"jimeng-4.5\", \"prompt\": \"A running lion, portrait orientation\", \"resolution\": \"2k\", \"intelligent_ratio\": true}"
```

**Supported Models**:
- `nanobananapro`: International sites only, supports `ratio` and `resolution`.
- `nanobanana`: International sites only.
- `jimeng-4.5`: Works on all sites, supports all 2k/4k ratios and intelligent_ratio. **(Default for all sites)**
- `jimeng-4.1`: China site only, supports all 2k/4k ratios and intelligent_ratio.
- `jimeng-4.0`: Works on all sites.
- `jimeng-3.1`: China site only.
- `jimeng-3.0`: Works on all sites.
- `jimeng-2.1`: China site only.
- `jimeng-xl-pro`

**Supported Ratios and Corresponding Resolutions**:
| resolution | ratio | Resolution |
|---|---|---|
| `1k` | `1:1` | 1024×1024 |
| | `4:3` | 768×1024 |
| | `3:4` | 1024×768 |
| | `16:9` | 1024×576 |
| | `9:16` | 576×1024 |
| | `3:2` | 1024×682 |
| | `2:3` | 682×1024 |
| | `21:9` | 1195×512 |
| `2k` (default) | `1:1` | 2048×2048 |
| | `4:3` | 2304×1728 |
| | `3:4` | 1728×2304 |
| | `16:9` | 2560×1440 |
| | `9:16` | 1440×2560 |
| | `3:2` | 2496×1664 |
| | `2:3` | 1664×2496 |
| | `21:9` | 3024×1296 |
| `4k` | `1:1` | 4096×4096 |
| | `4:3` | 4608×3456 |
| | `3:4` | 3456×4608 |
| | `16:9` | 5120×2880 |
| | `9:16` | 2880×5120 |
| | `3:2` | 4992×3328 |
| | `2:3` | 3328×4992 |
| | `21:9` | 6048×2592 |

### Image-to-Image

**POST** `/v1/images/compositions`

Generate a new image based on one or more input images, combined with a text prompt. Supports creative modes like image blending, style transfer, and content synthesis.

```bash
# International site image-to-image example (local file upload)
# US site uses "us-YOUR_SESSION_ID"
# Hong Kong site uses "hk-YOUR_SESSION_ID"
# Japan site uses "jp-YOUR_SESSION_ID"
curl -X POST http://localhost:5100/v1/images/compositions \
  -H "Authorization: Bearer us-YOUR_SESSION_ID" \
  -F "prompt=A cute cat, anime style" \
  -F "model=jimeng-4.5" \
  -F "images=@/path/to/your/local/cat.jpg"
```

**Request Parameters**:
- `model` (string, optional): The name of the model to use. Defaults to `jimeng-4.5` on all sites (China/US/HK/JP/SG).
- `prompt` (string): Text description of the image to guide the generation.
- `images` (array): An array of input images.
- `ratio` (string, optional): The aspect ratio of the image, defaults to `"1:1"`. Supported ratios: `1:1`, `4:3`, `3:4`, `16:9`, `9:16`, `3:2`, `2:3`, `21:9`.
- `resolution` (string, optional): The resolution level, defaults to `"2k"`. Supported resolutions: `1k`, `2k`, `4k`.
- `intelligent_ratio` (boolean, optional): Whether to enable intelligent ratio, defaults to `false`. **⚠️ This parameter only works for the jimeng-4.0/jimeng-4.1/jimeng-4.5 model; other models will ignore it.** When enabled, the system automatically adjusts the output ratio based on the prompt and input images.
- `negative_prompt` (string, optional): Negative prompt.
- `sample_strength` (number, optional): Sampling strength (0.0-1.0).
- `response_format` (string, optional): Response format ("url"(default) or "b64_json").

**Limits**:
- Number of input images: 1-10
- Supported image formats: Common formats (JPG, PNG, WebP, etc.).
- Image size limit: Recommended not to exceed 100MB per image.
- Generation time: Typically 30 seconds to 5 minutes; complex compositions may take longer.

**Usage Examples**:

```bash
# Example 1: URL image style transfer (using application/json)
curl -X POST http://localhost:5100/v1/images/compositions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d \
    "{\"model\": \"jimeng-4.5\", \"prompt\": \"Convert this photo into an oil painting style, with vibrant colors and distinct brushstrokes\", \"images\": [\"https://example.com/photo.jpg\"], \"ratio\": \"1:1\", \"resolution\": \"2k\", \"sample_strength\": 0.7}"

# Example 2: Local single file upload (using multipart/form-data)
curl -X POST http://localhost:5100/v1/images/compositions \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -F "prompt=A cute cat, anime style" \
  -F "model=jimeng-4.5" \
  -F "ratio=1:1" \
  -F "resolution=1k" \
  -F "images=@/path/to/your/local/cat.jpg"

# Example 3: Local multiple file upload (using multipart/form-data)
curl -X POST http://localhost:5100/v1/images/compositions \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -F "prompt=Merge these two images" \
  -F "model=jimeng-4.5" \
  -F "images=@/path/to/your/image1.jpg" \
  -F "images=@/path/to/your/image2.png"
```

**Successful Response Example** (applies to all examples above):
```json
{
  "created": 1703123456,
  "data": [
    {
      "url": "https://p3-sign.toutiaoimg.com/tos-cn-i-tb4s082cfz/abc123.webp"
    }
  ],
  "input_images": 1,
  "composition_type": "multi_image_synthesis"
}
```

#### ❓ **FAQ & Solutions**

**Q: What if my upload fails?**
A: Make sure the image URL is reachable, the format is supported, and the file size is under 100MB.

**Q: What if generation takes too long?**
A: Complex multi-image compositions can take longer. If it still isn't done after 10 minutes, try resubmitting the request.

**Q: How to improve composition quality?**
A:
- Start with high-quality input images.
- Write clear, detailed prompts.
- Tune the `sample_strength` parameter.
- Avoid mixing too many conflicting styles.

**Q: What image formats are supported?**
A: Common formats (JPG, PNG, WebP, GIF) work. JPG or PNG is recommended.

**Q: Can I use local images?**
A: Yes—direct local file upload is supported. See the "Local single file upload" example above. You can also keep using image URLs.

### Video Generation

**POST** `/v1/videos/generations`

Generate a video from a text prompt (Text-to-Video) or from start/end frame images (Image-to-Video). Supports three generation modes:

1. **Text-to-Video**: Pure text prompt without any images
2. **Image-to-Video**: Single image as the first frame
3. **First-Last Frame**: Two images as the first and last frames

> **Mode Detection**: The system automatically determines the generation mode based on the presence of images:
> - **No images** → Text-to-Video mode
> - **1 image** → Image-to-Video mode (only first_frame_image is provided)
> - **2 images** → First-Last Frame mode (both first_frame_image and end_frame_image are provided)

**Request Parameters**:
- `model` (string): The name of the video model to use.
- `prompt` (string): The text description of the video content.
- `ratio` (string, optional): Video aspect ratio, defaults to `"1:1"`. Supported ratios: `1:1`, `4:3`, `3:4`, `16:9`, `9:16`, `21:9`. **Note**: In image-to-video mode (when images are provided), this parameter will be ignored, and the video aspect ratio will be determined by the input image's actual ratio.
- `resolution` (string, optional): Video resolution, defaults to `"720p"`. Supported resolutions: `720p`, `1080p`.
- `duration` (number, optional): Video duration in seconds, defaults to `5`. Supported values: `5` (5 seconds), `10` (10 seconds).
- `file_paths` (array, optional): An array of image URLs to specify the **start frame** (1st element) and **end frame** (2nd element) of the video.
- `[file]` (file, optional): Local image files uploaded via `multipart/form-data` (up to 2) to specify the **start frame** and **end frame**. The field name can be arbitrary, e.g., `image1`.
- `response_format` (string, optional): Response format, supports `url` (default) or `b64_json`.

> **Image Input Description**:
> - You can provide input images via `file_paths` (URL array) or by directly uploading files.
> - If both methods are provided, the system will **prioritize the locally uploaded files**.
> - Up to 2 images are supported, the 1st as the start frame, the 2nd as the end frame.
> - **Important**: Once image input is provided (image-to-video or first-last frame video), the `ratio` parameter will be ignored, and the video aspect ratio will be determined by the input image's actual ratio. The `resolution` parameter remains effective.

**Supported Video Models**:
- `jimeng-video-3.5-pro` - Professional Edition v3.5 **(Default)**
- `jimeng-video-3.5` - Standard Edition v3.5
- `jimeng-video-3.0-pro` - Professional Edition
- `jimeng-video-3.0` - Standard Edition
- `jimeng-video-3.0-fast` - Fast Edition (China site only)
- `jimeng-video-2.0-pro` - Professional Edition v2
- `jimeng-video-2.0` - Standard Edition v2

**Usage Examples**:

```bash
# Example 1: Text-to-Video (0 images) - Pure text generation
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d \
    "{\"model\": \"jimeng-video-3.0\", \"prompt\": \"A lion running on the grassland\", \"ratio\": \"16:9\", \"resolution\": \"1080p\", \"duration\": 10}"

# Example 2: Image-to-Video (1 image) - Single image as first frame
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -F "prompt=A man is talking" \
  -F "model=jimeng-video-3.0" \
  -F "ratio=9:16" \
  -F "duration=5" \
  -F "image_file_1=@/path/to/your/first-frame.png"

# Example 3: First-Last Frame (2 images) - Two images as first and last frames
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -F "prompt=Smooth transition between scenes" \
  -F "model=jimeng-video-3.0" \
  -F "ratio=16:9" \
  -F "duration=10" \
  -F "image_file_1=@/path/to/first-frame.png" \
  -F "image_file_2=@/path/to/last-frame.png"

# Example 4: Image-to-Video with URL image
curl -X POST http://localhost:5100/v1/videos/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d \
    "{\"model\": \"jimeng-video-3.0\", \"prompt\": \"A woman dancing in a garden\", \"ratio\": \"4:3\", \"duration\": 10, \"filePaths\": [\"https://example.com/your-image.jpg\"]}"

```

### Chat Completions

**POST** `/v1/chat/completions`

```bash
curl -X POST http://localhost:5100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_ID" \
  -d \
    "{\"model\": \"jimeng-4.5\", \"messages\": [ { \"role\": \"user\", \"content\": \"Draw a landscape painting\" } ]}"
```

### Token API

#### Check Token Status

**POST** `/token/check`

Check if a token is valid and active.

**Request Parameters**:
- `token` (string): The session token to check

#### Get Credit Points

**POST** `/token/points`

Get the current credit balance for one or more tokens.

**Request Headers**:
- `Authorization`: Bearer token(s), multiple tokens separated by commas

#### Receive Daily Credits

**POST** `/token/receive`

Manually trigger daily credit collection (check-in). Attempts to claim credits and returns the latest credit information regardless of claim success.

**Request Headers**:
- `Authorization`: Bearer token(s), multiple tokens separated by commas

**Response Format**:
```json
[
  {
    "token": "your_token",
    "credits": {
      "giftCredit": 10,
      "purchaseCredit": 0,
      "vipCredit": 0,
      "totalCredit": 10
    }
  }
]
```

**Usage Example**:
```bash
# Single token
curl -X POST http://localhost:5100/token/receive \
  -H "Authorization: Bearer YOUR_SESSION_ID"

# Multiple tokens
curl -X POST http://localhost:5100/token/receive \
  -H "Authorization: Bearer TOKEN1,TOKEN2,TOKEN3"
```

## 🔍 API Response Format

### Image Generation Response
```json
{
  "created": 1759058768,
  "data": [
    {
      "url": "https://example.com/image1.jpg"
    },
    {
      "url": "https://example.com/image2.jpg"
    }
  ]
}
```

### Chat Completion Response
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1759058768,
  "model": "jimeng-4.5",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "![image](https://example.com/generated-image.jpg)"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

### Stream Response (SSE)
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1759058768,"model":"jimeng-4.5","choices":[{"index":0,"delta":{"role":"assistant","content":"🎨 Generating image, please wait..."},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1759058768,"model":"jimeng-4.5","choices":[{"index":1,"delta":{"role":"assistant","content":"![image](https://example.com/image.jpg)"},"finish_reason":"stop"}]}

data: [DONE]
```

## 🏗️ Project Architecture

```
jimeng-api/
├── src/
│   ├── api/
│   │   ├── controllers/          # Controller layer
│   │   │   ├── core.ts          # Core functions (network requests, file handling)
│   │   │   ├── images.ts        # Image generation logic
│   │   │   ├── videos.ts        # Video generation logic
│   │   │   └── chat.ts          # Chat interface logic
│   │   ├── routes/              # Route definitions
│   │   └── consts/              # Constant definitions
│   ├── lib/                     # Core library
│   │   ├── configs/            # Configuration loading
│   │   ├── consts/             # Constants
│   │   ├── exceptions/         # Exception classes
│   │   ├── interfaces/         # Interface definitions
│   │   ├── request/            # Request handling
│   │   ├── response/           # Response handling
│   │   ├── config.ts           # Configuration center
│   │   ├── server.ts           # Server core
│   │   ├── logger.ts           # Logger
│   │   ├── error-handler.ts    # Unified error handling
│   │   ├── smart-poller.ts     # Smart poller
│   │   └── aws-signature.ts    # AWS signature
│   ├── daemon.ts               # Daemon process
│   └── index.ts               # Entry file
├── configs/                    # Configuration files
├── Dockerfile                 # Docker configuration
└── package.json              # Project configuration
```

## 🔧 Core Components

### SmartPoller
- Adapts polling interval based on status codes.
- Multiple exit conditions to avoid invalid waiting.
- Detailed progress tracking and logging.

### Unified ErrorHandler
- Categorized error handling (network errors, API errors, timeouts, etc.).
- Automatic retry mechanism.
- User-friendly error messages.

### Safe JSON Parsing
- Automatically fixes common JSON format issues.
- Supports trailing commas and single quotes.
- Detailed parsing error logs.

## ⚙️ Advanced Configuration

### Polling Configuration
```typescript
export const POLLING_CONFIG = {
  MAX_POLL_COUNT: 900,    // Max polling attempts (15 minutes)
  POLL_INTERVAL: 5000,    // Base polling interval (5 second)
  STABLE_ROUNDS: 5,       // Stable rounds
  TIMEOUT_SECONDS: 900    // Timeout (15 minutes)
};
```

### Retry Configuration
```typescript
export const RETRY_CONFIG = {
  MAX_RETRY_COUNT: 3,     // Max retry attempts
  RETRY_DELAY: 5000       // Retry delay (5 seconds)
};
```

## 🐛 Troubleshooting

### Common Issues

1.  **JSON Parsing Error**
    -   Make sure your request body is valid.
    -   The system will automatically fix common format issues.

2.  **Invalid `sessionid`**
    -   Get a fresh `sessionid` from the appropriate site.
    -   Check if the `sessionid` format is correct.

3.  **Generation Timeout**
    -   Image generation: usually 1-3 minutes.
    -   Video generation: usually 3-15 minutes.
    -   The system will automatically handle timeouts.

4.  **Insufficient Credits**
    -   Go to the Jimeng/Dreamina official website to check your credit balance.
    -   The API returns detailed credit info.

## 🙏 Acknowledgements

This project is based on the contributions and inspiration of the following open-source project:

- **[jimeng-free-api-all](https://github.com/wwwzhouhui/jimeng-free-api-all)** - Thanks to this project for providing an important reference and technical basis for the reverse engineering of the Jimeng API. This project has improved its functionality and architecture based on it.

## 📄 License

GPL v3 License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This project is for learning and research purposes only. Please comply with relevant service terms and laws. Any consequences arising from the use of this project are the sole responsibility of the user.
