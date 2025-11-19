import Response from '@/lib/response/Response.ts';
import images from "./images.ts";
import chat from "./chat.ts";
import ping from "./ping.ts";
import token from './token.js';
import models from './models.ts';
import videos from './videos.ts';

export default [
    {
        get: {
            '/': async () => {
                return {
                    service: 'jimeng-api',
                    status: 'running',
                    version: '1.6.3',
                    description: '免费的AI图像和视频生成API服务 - 基于即梦AI的逆向工程实现',
                    documentation: 'https://github.com/iptag/jimeng-api',
                    endpoints: {
                        images: '/v1/images/generations',
                        compositions: '/v1/images/compositions',
                        videos: '/v1/videos/generations',
                        chat: '/v1/chat/completions',
                        models: '/v1/models',
                        health: '/ping'
                    }
                };
            }
        }
    },
    images,
    chat,
    ping,
    token,
    models,
    videos
];