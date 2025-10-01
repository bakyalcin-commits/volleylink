/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    serverComponentsExternalPackages: ['@ffmpeg-installer/ffmpeg'],
  },
};
module.exports = nextConfig;
