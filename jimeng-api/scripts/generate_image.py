#!/usr/bin/env python3
"""
Jimeng Image Generator Script
Generates images using the local Jimeng API and downloads them to the /pic folder.
"""

import os
import sys
import argparse
import requests
from pathlib import Path
from datetime import datetime
from io import BytesIO

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("⚠️  Warning: Pillow not installed. WebP images will be saved as-is.")
    print("   Install with: pip install Pillow")


def generate_text_to_image(
    prompt: str,
    session_id: str,
    model: str = "jimeng-4.0",
    ratio: str = "1:1",
    resolution: str = "2k",
    intelligent_ratio: bool = False,
    negative_prompt: str = None,
    sample_strength: float = None,
    api_url: str = "http://localhost:5100",
    output_dir: str = None
):
    """
    Generate images from text using the Jimeng API (文生图).

    Args:
        prompt: The text prompt for image generation
        session_id: Jimeng session ID (with region prefix if needed)
        model: Model to use (jimeng-4.0, jimeng-3.1, etc.)
        ratio: Aspect ratio (1:1, 16:9, etc.)
        resolution: Resolution level (1k, 2k, 4k)
        intelligent_ratio: Enable automatic ratio detection
        negative_prompt: Negative prompt (elements to avoid)
        sample_strength: Sampling strength (0.0-1.0)
        api_url: Jimeng API base URL
        output_dir: Output directory for downloaded images

    Returns:
        List of downloaded image file paths
    """
    endpoint = f"{api_url}/v1/images/generations"

    # Prepare request payload
    payload = {
        "model": model,
        "prompt": prompt,
        "ratio": ratio,
        "resolution": resolution,
        "intelligent_ratio": intelligent_ratio
    }

    if negative_prompt:
        payload["negative_prompt"] = negative_prompt

    if sample_strength is not None:
        payload["sample_strength"] = sample_strength

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {session_id}"
    }

    print(f"🎨 Generating image(s) with prompt: {prompt[:60]}...")
    print(f"📐 Model: {model}, Ratio: {ratio}, Resolution: {resolution}")

    # Call the API
    try:
        response = requests.post(endpoint, json=payload, headers=headers, timeout=300)
        response.raise_for_status()
        api_response = response.json()
    except requests.exceptions.RequestException as e:
        print(f"❌ Error calling API: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"   Response: {e.response.text}")
        sys.exit(1)

    # Download images
    return download_images(api_response, output_dir, "text")


def generate_image_to_image(
    prompt: str,
    session_id: str,
    images: list,
    model: str = "jimeng-4.0",
    ratio: str = "1:1",
    resolution: str = "2k",
    intelligent_ratio: bool = False,
    negative_prompt: str = None,
    sample_strength: float = None,
    api_url: str = "http://localhost:5100",
    output_dir: str = None
):
    """
    Generate images from input images using the Jimeng API (图生图).

    Args:
        prompt: The text prompt for image generation
        session_id: Jimeng session ID
        images: List of image paths or URLs (1-10 images)
        model: Model to use
        ratio: Aspect ratio
        resolution: Resolution level
        intelligent_ratio: Enable automatic ratio detection
        negative_prompt: Negative prompt
        sample_strength: Sampling strength
        api_url: Jimeng API base URL
        output_dir: Output directory for downloaded images

    Returns:
        List of downloaded image file paths
    """
    endpoint = f"{api_url}/v1/images/compositions"

    headers = {
        "Authorization": f"Bearer {session_id}"
    }

    # Determine if we need multipart/form-data (local files) or JSON (URLs)
    has_local_files = any(os.path.exists(img) for img in images)

    print(f"🎨 Generating image composition with prompt: {prompt[:60]}...")
    print(f"📐 Input images: {len(images)}, Model: {model}")

    try:
        if has_local_files:
            # Use multipart/form-data for file uploads
            files = []
            data = {
                "prompt": prompt,
                "model": model,
                "ratio": ratio,
                "resolution": resolution
            }

            if intelligent_ratio:
                data["intelligent_ratio"] = "true"

            if negative_prompt:
                data["negative_prompt"] = negative_prompt

            if sample_strength is not None:
                data["sample_strength"] = str(sample_strength)

            # Add image files
            for img_path in images:
                if os.path.exists(img_path):
                    files.append(('images', open(img_path, 'rb')))
                else:
                    # Assume it's a URL
                    if 'images' not in data:
                        data['images'] = []
                    data['images'].append(img_path)

            response = requests.post(endpoint, data=data, files=files, headers=headers, timeout=300)

            # Close file handles
            for _, file_obj in files:
                file_obj.close()
        else:
            # Use JSON for URL-based images
            headers["Content-Type"] = "application/json"
            payload = {
                "model": model,
                "prompt": prompt,
                "images": images,
                "ratio": ratio,
                "resolution": resolution,
                "intelligent_ratio": intelligent_ratio
            }

            if negative_prompt:
                payload["negative_prompt"] = negative_prompt

            if sample_strength is not None:
                payload["sample_strength"] = sample_strength

            response = requests.post(endpoint, json=payload, headers=headers, timeout=300)

        response.raise_for_status()
        api_response = response.json()

    except requests.exceptions.RequestException as e:
        print(f"❌ Error calling API: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"   Response: {e.response.text}")
        sys.exit(1)

    # Download images
    return download_images(api_response, output_dir, "composition")


def download_images(api_response: dict, output_dir: str, mode: str):
    """
    Download images from API response URLs.

    Args:
        api_response: JSON response from Jimeng API
        output_dir: Output directory path
        mode: Generation mode ("text" or "composition")

    Returns:
        List of downloaded file paths
    """
    # Determine output directory
    if output_dir is None:
        # Find project root
        current_dir = Path.cwd()
        project_root = current_dir

        # Look for project markers
        while project_root.parent != project_root:
            if any((project_root / marker).exists() for marker in
                   ['.git', '.claude', 'package.json', 'pyproject.toml', 'requirements.txt']):
                break
            project_root = project_root.parent

        output_dir = project_root / "pic"
    else:
        output_dir = Path(output_dir)

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"📁 Output directory: {output_dir}")

    # Download images
    downloaded_files = []
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    image_data_list = api_response.get("data", [])

    if not image_data_list:
        print("⚠️  No images in API response")
        return downloaded_files

    for idx, image_data in enumerate(image_data_list):
        image_url = image_data.get("url")

        if not image_url:
            print(f"⚠️  No URL for image {idx + 1}")
            continue

        print(f"🔗 Image {idx + 1}/{len(image_data_list)}: {image_url[:80]}...")

        # Download image
        try:
            img_response = requests.get(image_url, timeout=60)
            img_response.raise_for_status()

            # Detect if image is WebP format
            is_webp = ("format=.webp" in image_url or
                      image_url.endswith(".webp") or
                      img_response.content[:4] == b'RIFF')  # WebP magic number

            # Generate filename (always save as PNG)
            filename = f"jimeng_{timestamp}_{idx + 1}.png"
            file_path = output_dir / filename

            # Convert WebP to PNG if needed
            if is_webp and PIL_AVAILABLE:
                try:
                    # Load WebP image and convert to PNG
                    img = Image.open(BytesIO(img_response.content))

                    # Convert RGBA to RGB if needed (PNG supports both)
                    if img.mode in ('RGBA', 'LA', 'P'):
                        # Keep transparency
                        img.save(file_path, 'PNG', optimize=True)
                    else:
                        img.save(file_path, 'PNG', optimize=True)

                    print(f"✅ Downloaded and converted (WebP→PNG): {file_path}")
                except Exception as e:
                    print(f"⚠️  WebP conversion failed, saving original: {e}")
                    # Fallback: save as-is
                    with open(file_path.with_suffix('.webp'), 'wb') as f:
                        f.write(img_response.content)
                    file_path = file_path.with_suffix('.webp')
            else:
                # Save directly (PNG, JPG, or WebP without PIL)
                if is_webp and not PIL_AVAILABLE:
                    # No Pillow, save as WebP
                    file_path = file_path.with_suffix('.webp')
                    print(f"⚠️  Saving as WebP (Pillow not available)")

                with open(file_path, 'wb') as f:
                    f.write(img_response.content)

                print(f"✅ Downloaded: {file_path}")

            downloaded_files.append(str(file_path))

        except requests.exceptions.RequestException as e:
            print(f"❌ Error downloading image {idx + 1}: {e}")

    # Print summary
    print(f"\n📊 Summary:")
    print(f"   Created at: {api_response.get('created', 'N/A')}")
    print(f"   Downloaded: {len(downloaded_files)}/{len(image_data_list)} images")

    if mode == "composition" and "input_images" in api_response:
        print(f"   Input images: {api_response['input_images']}")
        print(f"   Composition type: {api_response.get('composition_type', 'N/A')}")

    return downloaded_files


def main():
    parser = argparse.ArgumentParser(
        description="Generate images using local Jimeng API",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    subparsers = parser.add_subparsers(dest="mode", help="Generation mode")

    # Text-to-Image subcommand
    text_parser = subparsers.add_parser("text", help="Text-to-image generation (文生图)")
    text_parser.add_argument("prompt", type=str, help="Text prompt for image generation")

    # Image-to-Image subcommand
    image_parser = subparsers.add_parser("image", help="Image-to-image generation (图生图)")
    image_parser.add_argument("prompt", type=str, help="Text prompt for image transformation")
    image_parser.add_argument(
        "--images",
        nargs="+",
        required=True,
        help="Input image paths or URLs (1-10 images)"
    )

    # Common arguments for both modes
    for subparser in [text_parser, image_parser]:
        subparser.add_argument(
            "--session-id",
            type=str,
            required=True,
            help="Jimeng session ID (with region prefix if needed: us-/hk-/jp-/sg-)"
        )
        subparser.add_argument(
            "--model",
            type=str,
            default="jimeng-4.5",
            choices=["jimeng-4.5", "jimeng-4.1", "jimeng-4.0", "jimeng-3.1", "jimeng-3.0", "jimeng-2.1", "jimeng-xl-pro", "nanobanana"],
            help="Model to use (default: jimeng-4.5; jimeng-4.1is domestic only and supports intelligent ratio)"
        )
        subparser.add_argument(
            "--ratio",
            type=str,
            default="1:1",
            choices=["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"],
            help="Aspect ratio (default: 1:1)"
        )
        subparser.add_argument(
            "--resolution",
            type=str,
            default="2k",
            choices=["1k", "2k", "4k"],
            help="Resolution level (default: 2k)"
        )
        subparser.add_argument(
            "--intelligent-ratio",
            action="store_true",
            help="Enable automatic ratio detection based on prompt"
        )
        subparser.add_argument(
            "--negative-prompt",
            type=str,
            help="Negative prompt (elements to avoid)"
        )
        subparser.add_argument(
            "--sample-strength",
            type=float,
            help="Sampling strength (0.0-1.0)"
        )
        subparser.add_argument(
            "--api-url",
            type=str,
            default="http://localhost:5100",
            help="Jimeng API base URL (default: http://localhost:5100)"
        )
        subparser.add_argument(
            "--output-dir",
            type=str,
            help="Output directory for images (defaults to project_root/pic)"
        )

    args = parser.parse_args()

    # Check if mode is specified
    if not args.mode:
        parser.print_help()
        sys.exit(1)

    # Validate sample_strength
    if args.sample_strength is not None:
        if args.sample_strength < 0.0 or args.sample_strength > 1.0:
            print("❌ Error: sample_strength must be between 0.0 and 1.0")
            sys.exit(1)

    # Generate images
    try:
        if args.mode == "text":
            downloaded_files = generate_text_to_image(
                prompt=args.prompt,
                session_id=args.session_id,
                model=args.model,
                ratio=args.ratio,
                resolution=args.resolution,
                intelligent_ratio=args.intelligent_ratio,
                negative_prompt=args.negative_prompt,
                sample_strength=args.sample_strength,
                api_url=args.api_url,
                output_dir=args.output_dir
            )
        else:  # image mode
            # Validate image count
            if len(args.images) < 1 or len(args.images) > 10:
                print("❌ Error: Number of images must be between 1 and 10")
                sys.exit(1)

            downloaded_files = generate_image_to_image(
                prompt=args.prompt,
                session_id=args.session_id,
                images=args.images,
                model=args.model,
                ratio=args.ratio,
                resolution=args.resolution,
                intelligent_ratio=args.intelligent_ratio,
                negative_prompt=args.negative_prompt,
                sample_strength=args.sample_strength,
                api_url=args.api_url,
                output_dir=args.output_dir
            )

        print(f"\n✨ Successfully generated and downloaded {len(downloaded_files)} image(s)!")

    except KeyboardInterrupt:
        print("\n\n⚠️  Generation cancelled by user")
        sys.exit(1)


if __name__ == "__main__":
    main()
