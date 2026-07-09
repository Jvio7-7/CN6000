import { NextRequest, NextResponse } from 'next/server';
import { createBooking } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { eventId, attendeeName, attendeeEmail } = body;

    if (!eventId || !attendeeName || !attendeeEmail) {
      return NextResponse.json(
        { error: 'eventId, attendeeName, and attendeeEmail are all required' },
        { status: 400 }
      );
    }

    const booking = await createBooking({ eventId, attendeeName, attendeeEmail });
    return NextResponse.json(booking, { status: 201 });
  } catch (err) {
    console.error('Failed to create booking:', err);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}
