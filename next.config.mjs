/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  outputFileTracingIncludes: {
    '/api/classic': ['./legacy/scout-classic.html']
  }
};

export default nextConfig;
