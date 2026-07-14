-- same UUID reasoning as schema-postgres.sql, generated app-side so both
-- clouds get the same value. drops tables first, re-run when schema changes

IF OBJECT_ID('FK_payments_bookings', 'F') IS NOT NULL
  ALTER TABLE payments DROP CONSTRAINT FK_payments_bookings;

IF OBJECT_ID('FK_bookings_events', 'F') IS NOT NULL
  ALTER TABLE bookings DROP CONSTRAINT FK_bookings_events;

IF OBJECT_ID('FK_bookings_users', 'F') IS NOT NULL
  ALTER TABLE bookings DROP CONSTRAINT FK_bookings_users;

IF OBJECT_ID('FK_events_users', 'F') IS NOT NULL
  ALTER TABLE events DROP CONSTRAINT FK_events_users;

IF OBJECT_ID('payments', 'U') IS NOT NULL
  DROP TABLE payments;

IF OBJECT_ID('notifications', 'U') IS NOT NULL
  DROP TABLE notifications;

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
  security_question NVARCHAR(255) NOT NULL,
  security_answer_hash NVARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT GETDATE(),
  origin_cloud NVARCHAR(10) NOT NULL DEFAULT 'azure'
);

-- see schema-postgres.sql for why user_id and cancelled_at exist
CREATE TABLE events (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  user_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(255) NOT NULL,
  event_date DATETIME NOT NULL,
  location NVARCHAR(255) NOT NULL,
  capacity INT NOT NULL DEFAULT 0,
  price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  cancelled_at DATETIME,
  origin_cloud NVARCHAR(10) NOT NULL DEFAULT 'azure',
  CONSTRAINT FK_events_users FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE bookings (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  user_id UNIQUEIDENTIFIER NOT NULL,
  event_id UNIQUEIDENTIFIER NOT NULL,
  attendee_name NVARCHAR(255) NOT NULL,
  attendee_email NVARCHAR(255) NOT NULL,
  cancelled_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT GETDATE(),
  origin_cloud NVARCHAR(10) NOT NULL DEFAULT 'azure',
  CONSTRAINT FK_bookings_events FOREIGN KEY (event_id) REFERENCES events(id),
  CONSTRAINT FK_bookings_users FOREIGN KEY (user_id) REFERENCES users(id)
);

-- fake payments, see sql/schema-postgres.sql
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

CREATE TABLE notifications (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  recipient_email NVARCHAR(255) NOT NULL,
  subject NVARCHAR(255) NOT NULL,
  body NVARCHAR(MAX) NOT NULL,
  related_booking_id UNIQUEIDENTIFIER,
  status NVARCHAR(20) NOT NULL DEFAULT 'sent',
  created_at DATETIME NOT NULL DEFAULT GETDATE(),
  origin_cloud NVARCHAR(10) NOT NULL DEFAULT 'azure'
);
