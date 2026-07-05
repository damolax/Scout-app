import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { displayDomain, makeNormalizedKey, normalizeEmail, normalizePhone, normalizeWebsite } from '@/lib/normalize';

export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-scout-workspace-key') || '';
    if (!apiKey) return NextResponse.json({ error: 'Missing x-scout-workspace-key' }, { status: 401 });

    const admin = createAdminClient();
    const { data: workspace, error: workspaceError } = await admin
      .from('workspaces')
      .select('id')
      .eq('api_key', apiKey)
      .single();
    if (workspaceError || !workspace) return NextResponse.json({ error: 'Invalid workspace key' }, { status: 403 });

    const body = await request.json();
    const rows = Array.isArray(body.businesses) ? body.businesses : [];
    const payload = rows.map((item: any) => {
      const email = normalizeEmail(item.email);
      const website = normalizeWebsite(item.website || item.url);
      const domain = displayDomain({ domain: item.domain, website, email });
      const name = String(item.name || item.businessName || item.company || '').trim();
      const phone = normalizePhone(item.phone);
      const normalized_key = makeNormalizedKey({ email, domain, website, name, phone });
      if (!normalized_key) return null;
      return {
        workspace_id: workspace.id,
        name: name || null,
        email: email || null,
        phone: phone || null,
        website: website || null,
        domain: domain || null,
        category: item.category || item.industry || null,
        location: item.location || item.address || null,
        source: item.source || 'extension',
        status: 'pending',
        normalized_key,
        raw: item
      };
    }).filter(Boolean);

    const { data, error } = await admin.from('businesses').upsert(payload, {
      onConflict: 'workspace_id,normalized_key',
      ignoreDuplicates: true
    }).select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, received: rows.length, inserted: data?.length || 0 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
