import Link from 'next/link';

interface EventCardProps {
  id: string;
  title: string;
  eventDate: string;
  location: string;
  capacity: number;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export default function EventCard({ id, title, eventDate, location, capacity }: EventCardProps) {
  const d = new Date(eventDate);
  const month = MONTHS[d.getMonth()];
  const day = d.getDate();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <Link href={`/book?eventId=${id}`} className="ticket">
      <div className="ticketMain">
        <h3 className="ticketTitle">{title}</h3>
        <p className="ticketMeta">
          {time} &middot; {location}
        </p>
        <p className="ticketMeta">{capacity} spots</p>
      </div>
      <div className="ticketStub">
        <span className="stubMonth">{month}</span>
        <span className="stubDay">{day}</span>
      </div>
    </Link>
  );
}
