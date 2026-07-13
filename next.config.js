/** @type {import('next').NextConfig} */
const nextConfig = {
  // static export - no server needed, everything calls the API directly
  output: 'export',
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
