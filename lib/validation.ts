// mirrors lambda/layer/nodejs/auth.js's validatePassword exactly - this
// is just for immediate UI feedback, the backend enforces the real rule
export function validatePasswordClient(password: string): string | null {
  if (password.length < 12 || password.length > 24) {
    return 'Password must be 12-24 characters long';
  }
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must include a number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include a special character';
  return null;
}

export const PASSWORD_HINT =
  '12-24 characters, with at least one uppercase letter, one lowercase letter, one number, and one special character.';
