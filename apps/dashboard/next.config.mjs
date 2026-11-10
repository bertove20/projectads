import path from 'path';
import { fileURLToPath } from 'url';

/** @type {import('next').NextConfig} */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const nextConfig = {
  output: 'standalone',
  // Monorepo: lacak dependency dari root agar output standalone lengkap
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../'),
  poweredByHeader: false,
  reactStrictMode: true,
  // Di VPS, Caddy meneruskan /api/* langsung ke service api. Rewrite ini untuk pengembangan lokal.
  async rewrites() {
    return process.env.NODE_ENV === 'production' ? [] : [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
