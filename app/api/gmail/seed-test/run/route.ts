export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
export async function POST() {
  return NextResponse.json({ success: false, disabled: true, error: 'Placement testing is not included in this zero-paid-API release.' }, { status: 403 });
}
