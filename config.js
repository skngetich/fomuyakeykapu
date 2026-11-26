// Site-wide settings shared by the landing page and the app.

/**
 * Google Form "pre-filled link" for feedback, with APPVERSION typed into the
 * App version field when the link was made. The app swaps APPVERSION for the
 * running version and phone type. Empty hides every feedback link.
 */
export const FEEDBACK_FORM = '';

/** Explainer video, relative to the site root. */
export const VIDEO = 'media/how-it-works.mp4';

/** Fill in a feedback link for this release, or null when none is set up. */
export function feedbackUrl(version) {
  if (!FEEDBACK_FORM) return null;
  const ua = globalThis.navigator?.userAgent ?? '';
  const phone = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'Other';
  return FEEDBACK_FORM.replace('APPVERSION', encodeURIComponent(`${version} (${phone})`));
}
