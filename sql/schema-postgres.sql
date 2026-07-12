-- UUID primary keys (not SERIAL) are required for active-active
-- replication: two independent clouds each generating their own
-- auto-increment integers would eventually collide (AWS's event #7 and
-- Azure's event #7 would be two different, unrelated records). UUIDs are
-- globally unique regardless of which cloud created the row, so a record
-- can be replicated to the other cloud with its ID intact and no risk of
-- clashing with something the other cloud generated independently.
--
-- This script is destructive on purpose (drops existing tables first) -
-- it's meant to be re-run whenever the schema changes, not just once.
-- There's no production data here to preserve.

DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  origin_cloud VARCHAR(10) NOT NULL DEFAULT 'aws'
);

CREATE TABLE events (
  id UUID PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  event_date TIMESTAMP NOT NULL,
  location VARCHAR(255) NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0,
  origin_cloud VARCHAR(10) NOT NULL DEFAULT 'aws'
);

CREATE TABLE bookings (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id),
  attendee_name VARCHAR(255) NOT NULL,
  attendee_email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  origin_cloud VARCHAR(10) NOT NULL DEFAULT 'aws'
);
