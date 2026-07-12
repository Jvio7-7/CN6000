-- UNIQUEIDENTIFIER (UUID) primary keys, matching the Postgres side, for
-- the same reason: collision-free replication between two independent
-- clouds. The ID is generated application-side (not via NEWID() default)
-- so the exact same value can be written to both databases.
--
-- This script is destructive on purpose (drops existing tables first) -
-- it's meant to be re-run whenever the schema changes, not just once.
-- There's no production data here to preserve. FK-referencing tables
-- must be dropped before the tables they reference.

IF OBJECT_ID('FK_payments_bookings', 'F') IS NOT NULL
  ALTER TABLE payments DROP CONSTRAINT FK_payments_bookings;

IF OBJECT_ID('FK_bookings_events', 'F') IS NOT NULL
  ALTER TABLE bookings DROP CONSTRAINT FK_bookings_events;

IF OBJECT_ID('payments', 'U') IS NOT NULL
  DROP TABLE payments;

IF OBJECT_ID('bookings', 'U') IS NOT NULL
  DROP TABLE bookings;

IF OBJECT_ID('events', 'U') IS NOT NULL
  DROP TABLE events;

IF OBJECT_ID('users', 'U') IS NOT NULL
  DROP TABLE users;

CREATE TABLE users (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  name NVARCHAR(255) NOT NULL,
  email NVARCHAR(255) NOT NULL UNIQUE,
  password_hash NVARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT GETDATE(),
  origin_cloud NVARCHAR(10) NOT NULL DEFAULT 'azure'
);

CREATE TABLE events (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  title NVARCHAR(255) NOT NULL,
  event_date DATETIME NOT NULL,
  location NVARCHAR(255) NOT NULL,
  capacity INT NOT NULL DEFAULT 0,
  origin_cloud NVARCHAR(10) NOT NULL DEFAULT 'azure'
);

CREATE TABLE bookings (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  event_id UNIQUEIDENTIFIER NOT NULL,
  attendee_name NVARCHAR(255) NOT NULL,
  attendee_email NVARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT GETDATE(),
  origin_cloud NVARCHAR(10) NOT NULL DEFAULT 'azure',
  CONSTRAINT FK_bookings_events FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Simulated payments only - see schema-postgres.sql for the reasoning.
CREATE TABLE payments (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  booking_id UNIQUEIDENTIFIER NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency NVARCHAR(3) NOT NULL DEFAULT 'USD',
  card_last4 NVARCHAR(4) NOT NULL,
  status NVARCHAR(20) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT GETDATE(),
  origin_cloud NVARCHAR(10) NOT NULL DEFAULT 'azure',
  CONSTRAINT FK_payments_bookings FOREIGN KEY (booking_id) REFERENCES bookings(id)
);
