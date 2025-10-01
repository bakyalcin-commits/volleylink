/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    // ffmpeg paketi bundle’a gömülmesin; Node runtime’da çöz
    serverComponentsExternalPackages: ['@ffmpeg-installer/ffmpeg'],
  },
};

module.exports = nextConfig;
