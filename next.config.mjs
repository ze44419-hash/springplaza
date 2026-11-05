/** @type {import('next').NextConfig} */
// CORS: الـ API same-origin افتراضيًا. لو محتاج دومين تاني يكلمه، حط APP_ORIGIN في Vercel (مثال: https://cafe.example.com).
const origin = process.env.APP_ORIGIN;
const security = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  images: { unoptimized: true }, // product images are pre-shrunk to 640px WebP at upload time
  experimental: { optimizePackageImports: ['lucide-react', 'dexie', 'dexie-react-hooks'] },
  async headers() {
    return [
      { source: '/:path*', headers: security },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/icons/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      ...(origin ? [{
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: origin },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
          { key: 'Vary', value: 'Origin' },
        ],
      }] : []),
    ];
  },
};
export default nextConfig;
