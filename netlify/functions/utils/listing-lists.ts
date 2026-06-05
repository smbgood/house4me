import { verifyGoogleRefreshToken } from '../auth';
import { supabaseAdmin } from './supabase';

export const MAIN_LIST_SLUG = 'main';

const INGEST_TOKEN_ENV_KEYS = [
  'TRULIA_INGEST_TOKEN',
  'FORRENT_INGEST_TOKEN',
  'ZILLOW_INGEST_TOKEN',
  'REALTOR_INGEST_TOKEN'
] as const;

export interface ListingList {
  id: string;
  slug: string;
  name: string;
  is_system: boolean;
  created_at: string;
}

export type AuthorizedRequest =
  | {
      kind: 'ingest';
    }
  | {
      kind: 'google';
      googleEmail: string;
    };

export function parseBearerToken(headers: Record<string, string | undefined>): string | null {
  const authHeader = headers['authorization'] ?? headers['Authorization'];
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function isConfiguredIngestToken(token: string): boolean {
  if (!token) {
    return false;
  }
  return INGEST_TOKEN_ENV_KEYS.some((envKey) => {
    const configured = process.env[envKey];
    return Boolean(configured) && configured === token;
  });
}

export async function authorizeGoogleOrIngest(
  headers: Record<string, string | undefined>
): Promise<AuthorizedRequest | null> {
  const token = parseBearerToken(headers);
  if (!token) {
    return null;
  }

  if (isConfiguredIngestToken(token)) {
    return { kind: 'ingest' };
  }

  const verification = await verifyGoogleRefreshToken(token);
  const googleEmail = verification.email?.trim().toLowerCase();
  if (!verification.valid || !googleEmail) {
    return null;
  }

  return {
    kind: 'google',
    googleEmail
  };
}

function slugifyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 60);
}

function getNextSlug(baseSlug: string, attempt: number): string {
  if (attempt === 0) {
    return baseSlug;
  }
  const suffix = `-${attempt + 1}`;
  return `${baseSlug.slice(0, Math.max(1, 60 - suffix.length))}${suffix}`;
}

async function ensureMainListExists(): Promise<void> {
  await supabaseAdmin.from('rental_listing_lists').upsert(
    {
      slug: MAIN_LIST_SLUG,
      name: 'Main',
      is_system: true
    },
    {
      onConflict: 'slug'
    }
  );
}

function toListingList(row: unknown): ListingList | null {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const candidate = row as Record<string, unknown>;
  if (
    typeof candidate['id'] !== 'string' ||
    typeof candidate['slug'] !== 'string' ||
    typeof candidate['name'] !== 'string' ||
    typeof candidate['is_system'] !== 'boolean'
  ) {
    return null;
  }

  return {
    id: candidate['id'],
    slug: candidate['slug'],
    name: candidate['name'],
    is_system: candidate['is_system'],
    created_at: typeof candidate['created_at'] === 'string' ? candidate['created_at'] : ''
  };
}

export async function getListingLists(): Promise<ListingList[]> {
  await ensureMainListExists();

  const result = await supabaseAdmin
    .from('rental_listing_lists')
    .select('id, slug, name, is_system, created_at')
    .order('is_system', { ascending: false })
    .order('name', { ascending: true });

  if (result.error) {
    throw result.error;
  }

  const parsedRows = (result.data ?? [])
    .map((row) => toListingList(row))
    .filter((row): row is ListingList => Boolean(row));

  return parsedRows.sort((a, b) => {
    if (a.slug === MAIN_LIST_SLUG) {
      return -1;
    }
    if (b.slug === MAIN_LIST_SLUG) {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export async function createListingList(name: string): Promise<ListingList> {
  const normalizedName = name.trim().replace(/\s+/g, ' ');
  if (!normalizedName) {
    throw new Error('List name is required.');
  }

  const baseSlug = slugifyName(normalizedName);
  if (!baseSlug || baseSlug === MAIN_LIST_SLUG) {
    throw new Error('List name must include letters or numbers and cannot be "Main".');
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const slug = getNextSlug(baseSlug, attempt);
    const result = await supabaseAdmin
      .from('rental_listing_lists')
      .insert({
        slug,
        name: normalizedName,
        is_system: false
      })
      .select('id, slug, name, is_system, created_at')
      .single();

    if (!result.error) {
      const created = toListingList(result.data);
      if (!created) {
        throw new Error('Failed to parse created list.');
      }
      return created;
    }

    if (result.error.code === '23505') {
      continue;
    }
    throw result.error;
  }

  throw new Error('Unable to create list slug. Please try a different name.');
}

export async function resolveListingListByIdOrSlug(input: {
  listId?: string | null;
  listSlug?: string | null;
}): Promise<ListingList | null> {
  const listId = input.listId?.trim();
  const listSlug = input.listSlug?.trim().toLowerCase();

  if (listSlug === MAIN_LIST_SLUG) {
    await ensureMainListExists();
  }

  if (listId) {
    const byId = await supabaseAdmin
      .from('rental_listing_lists')
      .select('id, slug, name, is_system, created_at')
      .eq('id', listId)
      .maybeSingle();
    if (byId.error) {
      throw byId.error;
    }
    return toListingList(byId.data);
  }

  if (!listSlug || listSlug === MAIN_LIST_SLUG) {
    const mainResult = await supabaseAdmin
      .from('rental_listing_lists')
      .select('id, slug, name, is_system, created_at')
      .eq('slug', MAIN_LIST_SLUG)
      .maybeSingle();
    if (mainResult.error) {
      throw mainResult.error;
    }
    return toListingList(mainResult.data);
  }

  const bySlug = await supabaseAdmin
    .from('rental_listing_lists')
    .select('id, slug, name, is_system, created_at')
    .eq('slug', listSlug)
    .maybeSingle();
  if (bySlug.error) {
    throw bySlug.error;
  }
  return toListingList(bySlug.data);
}
