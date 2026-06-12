// Iraqi phone number normalization for the phone-OTP layer (migration
// 050). All canonical storage is +964 followed by exactly 10 digits
// (matches the CHECK constraint on users.phone_e164). Input from users
// arrives in many flavours — local "07501234567", spaced "+964 750
// 123 4567", parenthesised "(0750) 123-4567", etc. — and we normalize
// them all to one shape before persisting or handing to OTPIQ.
//
// Non-Iraqi numbers are rejected. Per the locked design decision in
// FEATURE.md "Phone OTP", we ship Stage B as IQ-only; international
// support arrives in a later migration if business demand appears.

const IQ_COUNTRY_CODE = '964';
// Iraqi mobile prefixes (all start with '7' in local form). 9 digits
// after the country code, leading '7'. So full international form is
// +964 + 10 digits where the first digit is '7'.
const FULL_E164_PATTERN = /^\+964[0-9]{10}$/;

export type PhoneParseResult =
  | { ok: true; e164: string }                                          // canonical form (+9647xxxxxxxxx)
  | { ok: false; reason: PhoneParseFailureReason; received: string };   // why we rejected it

export type PhoneParseFailureReason =
  | 'empty'
  | 'non_iraqi'           // a country code other than 964 was supplied
  | 'too_short'
  | 'too_long'
  | 'invalid_chars'
  | 'malformed';

// Normalize whatever the user typed into +9647xxxxxxxxx.
// Accepts:
//   '07501234567'          → +9647501234567   (local leading-0 mobile)
//   '7501234567'           → +9647501234567   (local no-leading-0)
//   '009647501234567'      → +9647501234567   (international 00 prefix)
//   '+9647501234567'       → +9647501234567   (already canonical)
//   '964 750 123 4567'     → +9647501234567   (spaced)
//   '+1 415 555 0100'      → ok:false 'non_iraqi'
//
// We deliberately do NOT accept ambiguous inputs that could match more
// than one country (e.g. a bare 10-digit string starting with non-7).
// The frontend renders a +964 prefix tile so users almost always submit
// the local format; this helper is the second line of defense.
export function parseIraqiPhone(raw: string | null | undefined): PhoneParseResult {
  if (raw == null) return { ok: false, reason: 'empty', received: '' };
  const trimmed = String(raw).trim();
  if (!trimmed) return { ok: false, reason: 'empty', received: trimmed };

  // Strip everything that isn't a digit or leading '+'. Anything else
  // (letters, * #) is invalid for an Iraqi phone.
  if (!/^[+\d\s().\-]+$/.test(trimmed)) {
    return { ok: false, reason: 'invalid_chars', received: trimmed };
  }
  let digits = trimmed.replace(/[^\d+]/g, '');

  // Normalise prefixes:
  //  +964…  → 964…
  //  00964… → 964…
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Now decide country.
  //  If it starts with 964, the rest must be 10 digits (Iraqi mobile).
  //  If it starts with a single '0' followed by '7…', strip the 0 and
  //    prepend 964.
  //  If it starts with '7' and is exactly 10 digits, prepend 964.
  //  Otherwise reject as non-Iraqi.
  let nationalRest: string;
  if (digits.startsWith(IQ_COUNTRY_CODE)) {
    nationalRest = digits.slice(IQ_COUNTRY_CODE.length);
  } else if (digits.startsWith('07') && digits.length === 11) {
    nationalRest = digits.slice(1);
  } else if (digits.startsWith('7') && digits.length === 10) {
    nationalRest = digits;
  } else {
    // Any other shape — either it's a different country code or it's
    // garbled. Either way, we don't accept it at this stage.
    return { ok: false, reason: 'non_iraqi', received: trimmed };
  }

  if (nationalRest.length < 10) return { ok: false, reason: 'too_short', received: trimmed };
  if (nationalRest.length > 10) return { ok: false, reason: 'too_long', received: trimmed };
  if (!nationalRest.startsWith('7')) {
    // Iraqi mobile numbers begin with 7 after the country code. Landlines
    // (which begin with 1) cannot receive WhatsApp or SMS OTPs, so we
    // reject them here rather than failing later at OTPIQ.
    return { ok: false, reason: 'non_iraqi', received: trimmed };
  }

  const e164 = `+${IQ_COUNTRY_CODE}${nationalRest}`;
  if (!FULL_E164_PATTERN.test(e164)) {
    return { ok: false, reason: 'malformed', received: trimmed };
  }
  return { ok: true, e164 };
}

// Strip the leading '+' for OTPIQ — their /sms endpoint takes the
// country code with no '+' (e.g. '9647501234567').
export function toOtpiqFormat(e164: string): string {
  return e164.startsWith('+') ? e164.slice(1) : e164;
}

// Mask all but the last 4 digits — used in logs and audit labels so we
// never persist a full phone number where ops can see it.
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const last4 = e164.slice(-4);
  const masked = '•'.repeat(Math.max(0, e164.length - 4));
  return `${masked}${last4}`;
}

// Public reason → user-facing English string. Callers map these into
// translatable keys at the controller boundary.
export function phoneParseReasonMessage(reason: PhoneParseFailureReason): string {
  switch (reason) {
    case 'empty':          return 'Phone number is required';
    case 'non_iraqi':      return 'Only Iraqi (+964) numbers are supported right now';
    case 'too_short':      return 'Phone number is too short';
    case 'too_long':       return 'Phone number is too long';
    case 'invalid_chars':  return 'Phone number contains invalid characters';
    case 'malformed':      return 'Phone number format is invalid';
  }
}
