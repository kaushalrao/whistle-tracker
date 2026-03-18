import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* For Turbopack */
  turbopack: {
    resolveAlias: {
      "fs": "./lib/noop.js",
      "util": "./lib/noop.js",
    },
  },
  /* For Webpack (if fallback) */
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        util: false,
      };
    }
    return config;
  },
};

export default nextConfig;
