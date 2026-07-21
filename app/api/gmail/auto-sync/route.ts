export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
export async function POST() {
  return NextResponse.json({ success: false, disabled: true, error: 'This feature is disabled in the Google send-only verification build.' }, { status: 403 });
}
