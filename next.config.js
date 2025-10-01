/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    // ffmpeg binary’i server bundle dışında bırak
    serverComponentsExternalPackages: ['@ffmpeg-installer/ffmpeg'],
  },
};
module.exports = nextConfig;
