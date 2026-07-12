-- UNIQUEIDENTIFIER (UUID) primary keys, matching the Postgres side, for
-- the same reason: collision-free replication between two independent
-- clouds. The ID is generated application-side (not via NEWID() default)
-- so the exact same value can be written to both databases.
--
-- This script is destructive on purpose (drops existing tables first) -
-- it's meant to be re-run whenever the schema changes, not just once.
-- There's no production data here to preserve. The FK constraint must be
-- dropped before the tables, since SQL Server won't let you drop a table
-- that something else still references.

IF OBJECT_ID('FK_bookings_events', 'F') IS NOT NULL
  ALTER TABLE bookings DROP CONSTRAINT FK_bookings_events;

IF OBJECT_ID('bookings', 'U') IS NOT NULL
  DROP TABLE bookings;

IF OBJECT_ID('events', 'U') IS NOT NULL
  DROP TABLE events;

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
