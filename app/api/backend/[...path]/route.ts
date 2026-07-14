import { NextRequest, NextResponse } from 'next/server';
import { errorMessage, isTransientError, withRetry } from '@/lib/app-error';

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backend) return NextResponse.json({ success: false, error: 'Scout backend URL is not configured.' }, { status: 503 });

  try {
    const { path } = await context.params;
    const target = new URL(path.join('/'), backend.endsWith('/') ? backend : `${backend}/`);
    request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('content-length');
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
    const canRetry = ['GET', 'HEAD'].includes(request.method);

    const response = await withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        return await fetch(target, {
          method: request.method,
          headers,
          body,
          redirect: 'manual',
          signal: controller.signal,
          cache: 'no-store'
        });
      } finally {
        clearTimeout(timeout);
      }
    }, {
      retries: canRetry ? 1 : 0,
      shouldRetry: (error) => canRetry && isTransientError(error)
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? 'Scout backend timed out. No action was repeated automatically.'
      : errorMessage(error, 'Scout backend is temporarily unavailable.');
    return NextResponse.json({ success: false, error: message, retryable: isTransientError(error) }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
