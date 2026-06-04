import crypto from 'node:crypto';

const PET_FRIENDLY_PATTERNS = [
  /\bpets?\s+(allowed|welcome|ok|okay|accepted)\b/i,
  /\bpet[-\s]?friendly\b/i,
  /\bdog[-\s]?friendly\b/i,
  /\bcat[-\s]?friendly\b/i
];

const NO_PETS_PATTERNS = [/\bno\s+pets?\b/i, /\bpets?\s+not\s+allowed\b/i];

const FENCE_YES_PATTERNS = [
  /\bfenced\b/i,
  /\bfenced\s+yard\b/i,
  /\bprivacy\s+fence\b/i,
  /\benclosed\s+yard\b/i
];

const FENCE_NO_PATTERNS = [/\bno\s+fence\b/i, /\bunfenced\b/i];

export function parseRent(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const match = value.replace(/,/g, '').match(/\$?\s*(\d{2,7})/);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function inferPetsValue(text: string): boolean | null {
  if (!text) {
    return null;
  }
  if (NO_PETS_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  if (PET_FRIENDLY_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  return null;
}

export function inferFenceValue(text: string): boolean | null {
  if (!text) {
    return null;
  }
  if (FENCE_NO_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  if (FENCE_YES_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  return null;
}

export function buildListingHash(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex');
}

export function toAbsoluteUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}
