'use client';

import React, { useState, useEffect } from 'react';

interface LogEntry {
  id: number;
  method: string;
  route: string;
  status: number;
  body: string;
}

interface EventRecord {
  id: string;
  title: string;
  event_date: string;
  location: string;
  capacity: number;
}

interface UserRecord {
  id: string;
  name: string;
  email: string;
  origin_cloud?: string;
}

// User auth calls a deployed cloud endpoint directly rather than a local
// Next.js API route (deliberate scope decision - see README). Point this
// at your AWS API Gateway or Azure Function App URL via env var.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

let logId = 0;

export default function Home() {
  const [eventForm, setEventForm] = useState({
    title: '',
    date: '',
    location: '',
    capacity: '',
  });
  const [bookingForm, setBookingForm] = useState({
    eventId: '',
    attendeeName: '',
    attendeeEmail: '',
  });
  const [paymentForm, setPaymentForm] = useState({
    bookingId: '',
    amount: '',
    cardNumber: '',
  });
  const [log, setLog] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [submittingEvent, setSubmittingEvent] = useState(false);
  const [submittingBooking, setSubmittingBooking] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const [user, setUser] = useState<UserRecord | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  function pushLog(method: string, route: string, status: number, body: unknown) {
    logId += 1;
    setLog((prev) => [
      { id: logId, method, route, status, body: JSON.stringify(body, null, 2) },
      ...prev,
    ]);
  }

  async function refreshEvents() {
    setLoadingEvents(true);
    try {
      const res = await fetch('/api/events');
      const data = await res.json();
      if (res.ok) setEvents(data);
    } catch (err) {
      // Silent - the log panel already surfaces API errors from form submits
    } finally {
      setLoadingEvents(false);
    }
  }

  async function loadSession() {
    const token = localStorage.getItem('token');
    if (!token || !API_BASE_URL) {
      setCheckingSession(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setUser(await res.json());
      } else {
        localStorage.removeItem('token');
      }
    } catch (err) {
      // Network error checking session - leave logged out, don't crash the page
    } finally {
      setCheckingSession(false);
    }
  }

  useEffect(() => {
    refreshEvents();
    loadSession();
  }, []);

  function bookThisEvent(id: string) {
    setBookingForm({ ...bookingForm, eventId: id });
    document.getElementById('attendeeName')?.focus();
  }

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    const path = authMode === 'register' ? '/users/register' : '/users/login';
    const payload =
      authMode === 'register'
        ? authForm
        : { email: authForm.email, password: authForm.password };

    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      pushLog('POST', path, res.status, data);

      if (res.ok) {
        localStorage.setItem('token', data.token);
        setUser(data.user);
        setAuthForm({ name: '', email: '', password: '' });
      } else {
        setAuthError(data.error || 'Something went wrong');
      }
    } catch (err) {
      setAuthError('Network error - check NEXT_PUBLIC_API_BASE_URL is set correctly');
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    setUser(null);
  }

  async function handleCreateEvent(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingEvent(true);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: eventForm.title,
          date: eventForm.date,
          location: eventForm.location,
          capacity: Number(eventForm.capacity),
        }),
      });
      const data = await res.json();
      pushLog('POST', '/api/events', res.status, data);
      if (res.ok) {
        setEventForm({ title: '', date: '', location: '', capacity: '' });
        refreshEvents();
      }
    } catch (err) {
      pushLog('POST', '/api/events', 0, { error: 'Network error' });
    } finally {
      setSubmittingEvent(false);
    }
  }

  async function handleBookEvent(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingBooking(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: bookingForm.eventId,
          attendeeName: bookingForm.attendeeName,
          attendeeEmail: bookingForm.attendeeEmail,
        }),
      });
      const data = await res.json();
      pushLog('POST', '/api/bookings', res.status, data);
      if (res.ok) {
        setBookingForm({ eventId: '', attendeeName: '', attendeeEmail: '' });
        setPaymentForm({ ...paymentForm, bookingId: data.id });
      }
    } catch (err) {
      pushLog('POST', '/api/bookings', 0, { error: 'Network error' });
    } finally {
      setSubmittingBooking(false);
    }
  }

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingPayment(true);
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: paymentForm.bookingId,
          amount: Number(paymentForm.amount),
          cardNumber: paymentForm.cardNumber,
        }),
      });
      const data = await res.json();
      pushLog('POST', '/api/payments', res.status, data);
      if (res.ok) {
        setPaymentForm({ bookingId: '', amount: '', cardNumber: '' });
      }
    } catch (err) {
      pushLog('POST', '/api/payments', 0, { error: 'Network error' });
    } finally {
      setSubmittingPayment(false);
    }
  }

  return (
    <main className="page">
      <div className="shell">
        <div className="topBar">
          <div>
            <p className="eyebrow">
              EVENT-APP <strong>//</strong> multi-cloud serverless booking service
            </p>
            <h1>Event Booking</h1>
          </div>

          {!checkingSession && (
            <div className="account">
              {user ? (
                <>
                  <span className="accountInfo">
                    {user.name} · <span className="accountEmail">{user.email}</span>
                    {user.origin_cloud && (
                      <span className="originTag">{user.origin_cloud}</span>
                    )}
                  </span>
                  <button className="logoutBtn" onClick={handleLogout}>
                    Log out
                  </button>
                </>
              ) : (
                <span className="accountInfo muted">Not signed in</span>
              )}
            </div>
          )}
        </div>

        <p className="subhead">
          Two-step flow: create an event, then book a slot against its ID.
          Every request below hits the live API and the raw response is
          logged underneath, same as the requests running against AWS
          Lambda and Azure Functions in the deployed environments.
        </p>

        {!checkingSession && !user && (
          <form className="card authCard" onSubmit={handleAuthSubmit}>
            <div className="cardHead">
              <h2 className="cardTitle">
                {authMode === 'login' ? 'Log in' : 'Create an account'}
              </h2>
              <button
                type="button"
                className="refreshBtn"
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                  setAuthError('');
                }}
              >
                {authMode === 'login' ? 'Need an account? Sign up' : 'Have an account? Log in'}
              </button>
            </div>

            {authMode === 'register' && (
              <div className="field">
                <label htmlFor="authName">Name</label>
                <input
                  id="authName"
                  required
                  value={authForm.name}
                  onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                  placeholder="Jin"
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="authEmail">Email</label>
              <input
                id="authEmail"
                required
                type="email"
                value={authForm.email}
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                placeholder="jin@example.com"
              />
            </div>

            <div className="field">
              <label htmlFor="authPassword">Password</label>
              <input
                id="authPassword"
                required
                type="password"
                minLength={8}
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                placeholder="At least 8 characters"
              />
            </div>

            {authError && <p className="authError">{authError}</p>}
            {!API_BASE_URL && (
              <p className="authError">
                NEXT_PUBLIC_API_BASE_URL isn't set in .env.local - auth calls
                have nowhere to go.
              </p>
            )}

            <button className="submit" type="submit" disabled={authLoading}>
              {authLoading ? 'Please wait…' : authMode === 'login' ? 'Log in →' : 'Sign up →'}
            </button>
          </form>
        )}

        <div className="card eventsCard">
          <div className="cardHead">
            <span className="step">00</span>
            <h2 className="cardTitle">Upcoming events</h2>
            <button className="refreshBtn" onClick={refreshEvents} disabled={loadingEvents}>
              {loadingEvents ? 'Loading…' : '↻ Refresh'}
            </button>
          </div>

          {events.length === 0 ? (
            <p className="logEmpty">
              No events yet — create one below, or hit refresh if you expect
              to see events replicated from the other cloud.
            </p>
          ) : (
            <div className="eventList">
              {events.map((ev) => (
                <div className="eventRow" key={ev.id}>
                  <div className="eventInfo">
                    <span className="eventTitle">{ev.title}</span>
                    <span className="eventMeta">
                      {new Date(ev.event_date).toLocaleString()} · {ev.location} · cap {ev.capacity}
                    </span>
                    <span className="eventId">{ev.id}</span>
                  </div>
                  <button className="bookBtn" onClick={() => bookThisEvent(ev.id)}>
                    Book this →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid">
          <form className="card" onSubmit={handleCreateEvent}>
            <div className="cardHead">
              <span className="step">01</span>
              <h2 className="cardTitle">Create event</h2>
            </div>

            <div className="field">
              <label htmlFor="title">Title</label>
              <input
                id="title"
                required
                value={eventForm.title}
                onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                placeholder="CN6000 Demo Day"
              />
            </div>

            <div className="field">
              <label htmlFor="date">Date &amp; time</label>
              <input
                id="date"
                required
                type="datetime-local"
                value={eventForm.date}
                onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="location">Location</label>
              <input
                id="location"
                required
                value={eventForm.location}
                onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
                placeholder="LSBF Singapore"
              />
            </div>

            <div className="field">
              <label htmlFor="capacity">Capacity</label>
              <input
                id="capacity"
                required
                type="number"
                min="1"
                value={eventForm.capacity}
                onChange={(e) => setEventForm({ ...eventForm, capacity: e.target.value })}
                placeholder="50"
              />
            </div>

            <button className="submit" type="submit" disabled={submittingEvent}>
              {submittingEvent ? 'Creating…' : 'Create event →'}
            </button>
          </form>

          <form className="card" onSubmit={handleBookEvent}>
            <div className="cardHead">
              <span className="step">02</span>
              <h2 className="cardTitle">Book a slot</h2>
            </div>

            <div className="field">
              <label htmlFor="eventId">Event ID</label>
              <input
                id="eventId"
                required
                type="text"
                value={bookingForm.eventId}
                onChange={(e) => setBookingForm({ ...bookingForm, eventId: e.target.value })}
                placeholder="a1b2c3d4-... (from the log above)"
              />
            </div>

            <div className="field">
              <label htmlFor="attendeeName">Your name</label>
              <input
                id="attendeeName"
                required
                value={bookingForm.attendeeName}
                onChange={(e) =>
                  setBookingForm({ ...bookingForm, attendeeName: e.target.value })
                }
                placeholder="Jin"
              />
            </div>

            <div className="field">
              <label htmlFor="attendeeEmail">Email</label>
              <input
                id="attendeeEmail"
                required
                type="email"
                value={bookingForm.attendeeEmail}
                onChange={(e) =>
                  setBookingForm({ ...bookingForm, attendeeEmail: e.target.value })
                }
                placeholder="jin@example.com"
              />
            </div>

            <button className="submit" type="submit" disabled={submittingBooking}>
              {submittingBooking ? 'Booking…' : 'Book slot →'}
            </button>
          </form>
        </div>

        <form className="card paymentCard" onSubmit={handlePayment}>
          <div className="cardHead">
            <span className="step">03</span>
            <h2 className="cardTitle">Pay for booking</h2>
          </div>
          <p className="paymentNote">
            Simulated only — no real payment processor is involved anywhere
            in this project. A card ending in <code>0000</code> simulates a
            decline; anything else succeeds.
          </p>

          <div className="paymentRow">
            <div className="field">
              <label htmlFor="paymentBookingId">Booking ID</label>
              <input
                id="paymentBookingId"
                required
                type="text"
                value={paymentForm.bookingId}
                onChange={(e) => setPaymentForm({ ...paymentForm, bookingId: e.target.value })}
                placeholder="Auto-filled after booking above"
              />
            </div>

            <div className="field">
              <label htmlFor="amount">Amount (USD)</label>
              <input
                id="amount"
                required
                type="number"
                step="0.01"
                min="0.01"
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                placeholder="49.99"
              />
            </div>

            <div className="field">
              <label htmlFor="cardNumber">Card number (fake)</label>
              <input
                id="cardNumber"
                required
                type="text"
                value={paymentForm.cardNumber}
                onChange={(e) => setPaymentForm({ ...paymentForm, cardNumber: e.target.value })}
                placeholder="4242 4242 4242 4242"
              />
            </div>
          </div>

          <button className="submit" type="submit" disabled={submittingPayment}>
            {submittingPayment ? 'Processing…' : 'Pay →'}
          </button>
        </form>

        <div className="log">
          <p className="logHead">$ response log</p>
          {log.length === 0 ? (
            <p className="logEmpty">No requests yet — submit a form above.</p>
          ) : (
            log.map((entry) => (
              <div className="logEntry" key={entry.id}>
                <div className="logLine">
                  <span className="method">{entry.method}</span>
                  <span className="route">{entry.route}</span>
                  <span className={`status ${entry.status < 400 && entry.status > 0 ? 'ok' : 'err'}`}>
                    {entry.status || 'ERR'}
                  </span>
                </div>
                <pre className="logBody">{entry.body}</pre>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
