/** @type {import('next').NextConfig} */
const nextConfig = {
  // API route returns base64; allow larger payload for multi-image batches
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
}

export default nextConfig
