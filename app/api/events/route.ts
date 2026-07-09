import { NextRequest, NextResponse } from 'next/server';
import { createEvent } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, date, location, capacity } = body;

    if (!title || !date || !location || capacity === undefined) {
      return NextResponse.json(
        { error: 'title, date, location, and capacity are all required' },
        { status: 400 }
      );
    }

    const event = await createEvent({ title, date, location, capacity });
    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    console.error('Failed to create event:', err);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
