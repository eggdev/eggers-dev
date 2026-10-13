import { type NextRequest, NextResponse } from 'next/server';
export function proxy(request: NextRequest) {
  // Production uses Vercel Authentication with All Deployments, including the custom domain.
  // Fail closed until the operator has configured that gate. Remote interviews are a later milestone.
  if (process.env.VERCEL && process.env.STUDIO_DEPLOYMENT_PROTECTED !== 'true')
    return new NextResponse(
      'Enable Vercel Authentication for All Deployments before opening Studio.',
      { status: 503 },
    );
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && new URL(origin).host !== host)
    return new NextResponse('Cross-origin requests are not allowed.', { status: 403 });
  if (
    !process.env.VERCEL &&
    !['localhost', '127.0.0.1', '[::1]'].includes(request.nextUrl.hostname)
  )
    return new NextResponse('Local Studio only accepts loopback connections.', { status: 403 });
  const response = NextResponse.next();
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
