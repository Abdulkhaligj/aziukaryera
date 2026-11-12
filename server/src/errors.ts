// Error bodies in the formats supabase-js parses. The messages are the exact
// GoTrue/PostgREST strings the portal's Backend.translate() matches on.

/** GoTrue: { code, error_code, msg } */
export class AuthError extends Error {
  readonly status: number;
  readonly errorCode: string;
  constructor(status: number, errorCode: string, message: string) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
  }
  body() {
    return { code: this.status, error_code: this.errorCode, msg: this.message };
  }
}

export const authErrors = {
  invalidCredentials: () => new AuthError(400, 'invalid_credentials', 'Invalid login credentials'),
  emailNotConfirmed: () => new AuthError(400, 'email_not_confirmed', 'Email not confirmed'),
  userExists: () => new AuthError(422, 'user_already_exists', 'User already registered'),
  emailExists: () => new AuthError(422, 'email_exists', 'A user with this email address has already been registered'),
  weakPassword: (min: number) => new AuthError(422, 'weak_password', `Password should be at least ${min} characters.`),
  invalidEmail: (email: string) => new AuthError(400, 'email_address_invalid', `Email address "${email}" is invalid`),
  signupDisabled: () => new AuthError(422, 'signup_disabled', 'Signups not allowed for this instance'),
  otpSignupDisabled: () => new AuthError(422, 'otp_disabled', 'Signups not allowed for otp'),
  databaseSignup: () => new AuthError(500, 'unexpected_failure', 'Database error saving new user'),
  badJwt: () => new AuthError(403, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, token is unverifiable'),
  noAuthorization: () => new AuthError(401, 'no_authorization', 'This endpoint requires a valid Bearer token'),
  userNotFound: () => new AuthError(404, 'user_not_found', 'User not found'),
  sessionNotFound: () => new AuthError(403, 'session_not_found', 'Session from session_id claim in JWT does not exist'),
  refreshNotFound: () => new AuthError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found'),
  refreshUsed: () => new AuthError(400, 'refresh_token_already_used', 'Invalid Refresh Token: Already Used'),
  otpExpired: () => new AuthError(403, 'otp_expired', 'Token has expired or is invalid'),
  notAdmin: () => new AuthError(403, 'not_admin', 'User not allowed'),
  banned: () => new AuthError(400, 'user_banned', 'User is banned'),
  rateLimited: () => new AuthError(429, 'over_email_send_rate_limit', 'email rate limit exceeded'),
  tooFrequent: (seconds: number) => new AuthError(429, 'over_request_rate_limit', `For security purposes, you can only request this after ${seconds} seconds.`),
  validation: (message: string) => new AuthError(400, 'validation_failed', message),
  badRedirect: () => new AuthError(400, 'validation_failed', 'redirect_to is not allowed'),
  missingKey: () => new AuthError(401, 'no_api_key', 'No API key found in request')
};

/** A rule enforced by the database layer (CHECK, trigger, quota). */
export class DbRuleError extends Error {
  readonly sqlState: string;
  constructor(message: string, sqlState = '23514') {
    super(message);
    this.sqlState = sqlState;
  }
}
