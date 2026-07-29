/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // folder-style output (account/index.html) so Azure Storage resolves
  // paths the same way S3 does
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
