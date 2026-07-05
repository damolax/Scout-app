import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/main-scout', request.url));
  }

  const htmlPath = join(process.cwd(), 'legacy', 'scout-classic.html');
  let html = await readFile(htmlPath, 'utf8');

  // Keep the classic app clearly identified without changing its internal feature logic.
  html = html.replace(/<title>.*?<\/title>/i, '<title>Scout App Main Workspace inside v8 Cloud</title>');
  html = html.replace('</head>', `<script>
    window.SCOUT_V8_CLASSIC_BRIDGE = {
      mode: 'main-scout-inside-v8-cloud',
      loadedAt: new Date().toISOString(),
      note: 'Full Scout App feature set preserved while v8 cloud migration continues.'
    };
  </script></head>`);

  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0'
    }
  });
}
