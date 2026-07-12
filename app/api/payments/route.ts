import { NextRequest, NextResponse } from 'next/server';
import { createPayment } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { bookingId, amount, currency, cardNumber } = body;

    if (!bookingId || !amount || !cardNumber) {
      return NextResponse.json(
        { error: 'bookingId, amount, and cardNumber are all required' },
        { status: 400 }
      );
    }
    if (cardNumber.replace(/\s/g, '').length < 12) {
      return NextResponse.json({ error: 'cardNumber does not look valid' }, { status: 400 });
    }

    const payment = await createPayment({ bookingId, amount, currency, cardNumber });
    const status = payment.status === 'declined' ? 402 : 201;

    return NextResponse.json(payment, { status });
  } catch (err) {
    console.error('Failed to process payment:', err);
    return NextResponse.json({ error: 'Failed to process payment' }, { status: 500 });
  }
}
