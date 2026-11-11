import { NextResponse, type NextRequest } from 'next/server';

/**
 * Gerbang login di sisi server: halaman dashboard tidak dikirim sama sekali ke pengunjung tanpa cookie sesi.
 * Validasi sesi yang sebenarnya (kedaluwarsa, dicabut, MFA, status akun) tetap di API pada setiap request data.
 */
const PUBLIC = ['/login', '/mfa'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.get('eaip_session')?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // Semua halaman kecuali aset Next.js, API (diproksikan ke backend), dan file statis.
  matcher: ['/((?!_next/|api/|favicon\\.ico|robots\\.txt|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)'],
};
