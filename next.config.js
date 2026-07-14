/** @type {import('next').NextConfig} */
const nextConfig = {
  // static export - no server needed, everything calls the API directly
  output: 'export',
  // folder/index.html output (e.g. account/index.html) instead of flat
  // account.html - S3 auto-resolves extensionless URLs to a matching
  // .html file, but Azure Storage's static website feature never added
  // that (a real, still-open gap in Azure vs S3, not a config mistake).
  // Both platforms DO resolve index.html inside a folder-style path
  // though, so this makes both clouds behave identically instead of
  // relying on an AWS-only convenience.
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
