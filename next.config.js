/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: false },
  webpack: (config) => {
    config.externals = config.externals || [];
    // ffmpeg-static'ı server runtime'da require edeceğiz; bundle'a gömmeyelim
    config.externals.push({ "ffmpeg-static": "commonjs ffmpeg-static" });
    return config;
  },
};

module.exports = nextConfig;
