'use client';

import React, { useState } from 'react';

interface LogEntry {
  id: number;
  method: string;
  route: string;
  status: number;
  body: string;
}

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
  const [log, setLog] = useState<LogEntry[]>([]);
  const [submittingEvent, setSubmittingEvent] = useState(false);
  const [submittingBooking, setSubmittingBooking] = useState(false);

  function pushLog(method: string, route: string, status: number, body: unknown) {
    logId += 1;
    setLog((prev) => [
      { id: logId, method, route, status, body: JSON.stringify(body, null, 2) },
      ...prev,
    ]);
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
      }
    } catch (err) {
      pushLog('POST', '/api/bookings', 0, { error: 'Network error' });
    } finally {
      setSubmittingBooking(false);
    }
  }

  return (
    <main className="page">
      <div className="shell">
        <p className="eyebrow">
          EVENT-APP <strong>//</strong> multi-cloud serverless booking service
        </p>
        <h1>Event Booking</h1>
        <p className="subhead">
          Two-step flow: create an event, then book a slot against its ID.
          Every request below hits the live API and the raw response is
          logged underneath, same as the requests running against AWS
          Lambda and Azure Functions in the deployed environments.
        </p>

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
