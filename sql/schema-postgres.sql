-- UUIDs instead of SERIAL - two clouds writing independently would
-- eventually generate the same auto-increment ID for different rows.
-- Drops tables first, meant to be re-run whenever the schema changes.

DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  security_question VARCHAR(255) NOT NULL,
  security_answer_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  origin_cloud VARCHAR(10) NOT NULL DEFAULT 'aws'
);

-- events and bookings now require a logged-in owner (user_id), so
-- cancel/delete can check ownership. cancelled_at is a soft delete -
-- hard-deleting an event that already has bookings/payments against it
-- would violate the foreign keys below, and soft delete also means
-- cancellation is just another field to replicate, not a whole new
-- "delete" message type.
CREATE TABLE events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  event_date TIMESTAMP NOT NULL,
  location VARCHAR(255) NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0,
  price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  cancelled_at TIMESTAMP,
  origin_cloud VARCHAR(10) NOT NULL DEFAULT 'aws'
);

CREATE TABLE bookings (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  event_id UUID NOT NULL REFERENCES events(id),
  attendee_name VARCHAR(255) NOT NULL,
  attendee_email VARCHAR(255) NOT NULL,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  origin_cloud VARCHAR(10) NOT NULL DEFAULT 'aws'
);

-- fake payments, no real processor. card ending in 0000 = declined
CREATE TABLE payments (
  id UUID PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings(id),
  amount NUMERIC(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  card_last4 VARCHAR(4) NOT NULL,
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  origin_cloud VARCHAR(10) NOT NULL DEFAULT 'aws'
);

-- log of booking/payment/cancellation events, shown on the account page.
-- no email provider - see security_question above for why password
-- reset doesn't need one either. not replicated - just a log of what
-- happened on this cloud, not shared state
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  recipient_email VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  related_booking_id UUID REFERENCES bookings(id),
  status VARCHAR(20) NOT NULL DEFAULT 'sent',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  origin_cloud VARCHAR(10) NOT NULL DEFAULT 'aws'
);
