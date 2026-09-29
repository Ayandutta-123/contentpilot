/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Hide the Next.js DevTools "N" badge (Route / Try Turbopack popover) in development
  devIndicators: false,
  // Apify competitor scrapes can exceed the default 30s rewrite proxy window
  experimental: {
    proxyTimeout: 1000 * 60 * 5,
  },
  async rewrites() {
    // Prefer INTERNAL_API_URL for Docker/K8s service mesh; fall back to public API_URL.
    // These are resolved at **build time** for `next build` — rebuild the web image
    // when changing internal API DNS. Local `next dev` re-reads env on restart.
    const apiBase =
      process.env.INTERNAL_API_URL ||
      process.env.API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'http://127.0.0.1:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase.replace(/\/$/, '')}/api/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${apiBase.replace(/\/$/, '')}/uploads/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
