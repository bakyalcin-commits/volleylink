/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: false },
  webpack: (config) => {
    // ffmpeg-static'ı runtime'da require edeceğiz; bundla gömmeyelim
    config.externals = config.externals || [];
    config.externals.push({
      "ffmpeg-static": "commonjs ffmpeg-static",
    });
    return config;
  },
};

module.exports = nextConfig;
