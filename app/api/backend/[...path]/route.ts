import { NextRequest, NextResponse } from 'next/server';

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backend) return NextResponse.json({ error: 'NEXT_PUBLIC_BACKEND_URL is not configured' }, { status: 500 });
  const { path } = await context.params;
  const target = new URL(path.join('/'), backend.endsWith('/') ? backend : `${backend}/`);
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  const headers = new Headers(request.headers);
  headers.delete('host');

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
    redirect: 'manual'
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  return new NextResponse(response.body, {
    status: response.status,
    headers: responseHeaders
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
