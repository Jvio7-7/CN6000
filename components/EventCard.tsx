import Link from 'next/link';

interface EventCardProps {
  id: string;
  title: string;
  eventDate: string;
  location: string;
  capacity: number;
  price: number;
  bookingCount: number;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export default function EventCard({
  id,
  title,
  eventDate,
  location,
  capacity,
  price,
  bookingCount,
}: EventCardProps) {
  const d = new Date(eventDate);
  const month = MONTHS[d.getMonth()];
  const day = d.getDate();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const full = bookingCount >= capacity;

  return (
    <Link href={`/book?eventId=${id}`} className="ticket">
      <div className="ticketMain">
        <h3 className="ticketTitle">{title}</h3>
        <p className="ticketMeta">
          {time} &middot; {location}
        </p>
        <p className="ticketMeta">
          {bookingCount} / {capacity} spots{full ? ' \u2014 full' : ''} &middot;{' '}
          {price > 0 ? `$${price.toFixed(2)}` : 'Free'}
        </p>
      </div>
      <div className="ticketStub">
        <span className="stubMonth">{month}</span>
        <span className="stubDay">{day}</span>
      </div>
    </Link>
  );
}
