'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, useAuth } from '@/lib/auth-context';

function todayDateString() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// every clean 5-minute mark in a day (00:00, 00:05, ... 23:55) - a native
// datetime-local's step attribute counts increments from whatever `min`
// happens to be, not from clean marks, so e.g. a min of 14:37 offers
// 14:37/14:42/14:47/... instead of the tidy 14:40/14:45/14:50 wanted here.
// A plain dropdown sidesteps that entirely.
function allTimeSlots() {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}

export default function NewEventPage() {
  const router = useRouter();
  const { user, token, loading: authLoading } = useAuth();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [minDate] = useState(todayDateString);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  // only offer times still ahead of right now when the picked date is
  // today - any later date offers the full day
  const availableTimes = useMemo(() => {
    const all = allTimeSlots();
    if (date !== minDate) return all;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return all.filter((t) => {
      const [hh, mm] = t.split(':').map(Number);
      return hh * 60 + mm > nowMinutes;
    });
  }, [date, minDate]);

  // if switching back to today makes the previously-picked time invalid,
  // clear it rather than silently submit a stale value
  useEffect(() => {
    if (time && !availableTimes.includes(time)) {
      setTime('');
    }
  }, [availableTimes, time]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!API_BASE_URL) {
      setError('NEXT_PUBLIC_API_BASE_URL is not set — see .env.local');
      return;
    }
    if (!token) {
      setError('You need to be logged in to host an event.');
      return;
    }
    if (!date || !time) {
      setError('Pick a date and time.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title,
          date: `${date}T${time}:00`,
          location,
          capacity: Number(capacity),
          price: price ? Number(price) : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Try again.');
        return;
      }
      router.push('/');
    } catch (err) {
      setError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  if (authLoading || !user) {
    return <div className="shellNarrow" />;
  }

  return (
    <div className="shellNarrow">
      <form className="card" onSubmit={handleSubmit}>
        <h1 className="formTitle">Host an event</h1>
        <p className="formSub">Fill in the details and it'll show up on the events page right away.</p>

        {error && <div className="alert alertError">{error}</div>}

        <div className="field">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Summer Rooftop Social"
          />
        </div>

        <div className="paymentRow" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field">
            <label htmlFor="date">Date</label>
            <input
              id="date"
              required
              type="date"
              min={minDate}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="time">Time</label>
            <select
              id="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={!date}
            >
              <option value="" disabled>
                {date ? 'Select a time' : 'Pick a date first'}
              </option>
              {availableTimes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="location">Location</label>
          <input
            id="location"
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Marina Bay, Singapore"
          />
        </div>

        <div className="field">
          <label htmlFor="capacity">Capacity</label>
          <input
            id="capacity"
            required
            type="number"
            min="1"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="50"
          />
        </div>

        <div className="field">
          <label htmlFor="price">Price (USD)</label>
          <input
            id="price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Leave blank for a free event"
          />
          <span className="fieldHint">
            Attendees pay this exact amount at checkout — they won&apos;t enter their own amount.
          </span>
        </div>

        <button className="btn btnPrimary btnFull" type="submit" disabled={loading}>
          {loading ? 'Publishing…' : 'Publish event'}
        </button>
      </form>
    </div>
  );
}
