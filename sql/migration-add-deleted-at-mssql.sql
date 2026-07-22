IF COL_LENGTH('users', 'deleted_at') IS NULL
    ALTER TABLE users ADD deleted_at DATETIME;
