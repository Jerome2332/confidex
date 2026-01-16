/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Node.js polyfills
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };

    // Enable WebAssembly support for ShadowWire
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    // Configure WASM file handling
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });

    return config;
  },
};

module.exports = nextConfig;
