/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    // ffmpeg-static'i server tarafında external bırak (spawn ENOENT fix)
    serverComponentsExternalPackages: ['ffmpeg-static'],
  },
};

module.exports = nextConfig;
