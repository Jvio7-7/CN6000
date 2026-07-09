CREATE TABLE events (
  id INT IDENTITY(1,1) PRIMARY KEY,
  title NVARCHAR(255) NOT NULL,
  event_date DATETIME NOT NULL,
  location NVARCHAR(255) NOT NULL,
  capacity INT NOT NULL DEFAULT 0
);

CREATE TABLE bookings (
  id INT IDENTITY(1,1) PRIMARY KEY,
  event_id INT NOT NULL,
  attendee_name NVARCHAR(255) NOT NULL,
  attendee_email NVARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT GETDATE(),
  CONSTRAINT FK_bookings_events FOREIGN KEY (event_id) REFERENCES events(id)
);
