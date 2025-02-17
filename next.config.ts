import type { NextConfig } from 'next';
import webpack from 'webpack';

const nextConfig: NextConfig = {
  experimental: {
    ppr: true,
    // Enable turbopack if you wish, but ensure it supports DefinePlugin
    // turbopack: true,
  },
  images: {
    remotePatterns: [
      {
        hostname: 'avatar.vercel.sh',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Define a global constant `isBrowser` as false so that any
      // reference in Deepgram’s SDK will resolve without error.
      config.plugins.push(
        new webpack.DefinePlugin({
          isBrowser: 'false',
        })
      );
    }
    return config;
  },
};

export default nextConfig;
