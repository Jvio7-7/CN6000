export default function Home() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Event Booking API</h1>
      <p>This app exposes two endpoints:</p>
      <ul>
        <li>
          <code>POST /api/events</code> — create an event
        </li>
        <li>
          <code>POST /api/bookings</code> — book a slot at an event
        </li>
      </ul>
    </main>
  );
}
