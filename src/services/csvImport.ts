import { parse } from 'csv-parse/sync';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { normalizePhoneToE164 } from '../lib/phone';
import { addTag } from './tags';
import { writeAuditLog } from './auditLog';
import { enrollContactInCampaign } from '../outreach/enrollment';

export interface CsvImportRow {
  'Contact Name'?: string;
  Phone?: string;
  'Company Name'?: string;
  City?: string;
  Website?: string;
  Category?: string;
  Rating?: string;
  'Reviews Count'?: string;
  About?: string;
  'Review Sample'?: string;
  'Review Sample Rating'?: string;
  'Source Query'?: string;
  'Maps Rank'?: string;
  'Maps URL'?: string;
  'Place ID'?: string;
  Address?: string;
  Source?: string;
  Tags?: string;
  [key: string]: string | undefined;
}

// Columns already mapped to a first-class Contact field. Any other CSV column
// is captured as a free-form variable in Contact.customFields so it can be
// used as {{variable_name}} in message templates (e.g. a custom "Google
// Reviews Text" column becomes {{google_reviews_text}}).
const KNOWN_COLUMNS = new Set([
  'Contact Name',
  'Phone',
  'Company Name',
  'City',
  'Website',
  'Category',
  'Rating',
  'Reviews Count',
  'About',
  'Review Sample',
  'Review Sample Rating',
  'Source Query',
  'Maps Rank',
  'Maps URL',
  'Place ID',
  'Address',
  'Source',
  'Tags',
]);

/** Converts an arbitrary CSV header into a valid {{variable}} name: lowercase, ascii, underscores. */
function normalizeVariableName(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function extractCustomFields(row: CsvImportRow): Record<string, string> {
  const customFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (KNOWN_COLUMNS.has(key)) continue;
    if (!value) continue;
    const varName = normalizeVariableName(key);
    if (varName) customFields[varName] = value;
  }
  return customFields;
}

export interface ImportReport {
  totalRows: number;
  created: number;
  updated: number;
  enrolled: number;
  skipped: Array<{ row: number; reason: string; phone?: string }>;
  /** True when there is no active campaign, so imported contacts could not be auto-enrolled. */
  noActiveCampaign: boolean;
}

function toFloat(v?: string): number | null {
  if (!v) return null;
  const n = Number.parseFloat(v.replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

function toInt(v?: string): number | null {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Imports contacts from CSV. Deduplicates by phone_e164. Existing contacts are
 * updated non-destructively — reply history, do_not_contact_sms, outreach
 * status, messages and existing tags are NEVER touched or cleared here.
 *
 * Every imported contact is automatically tagged `outreach-ready` and enrolled
 * into the default active campaign (so it shows up on the Kanban board under
 * "Nuevo prospecto" immediately). Enrollment is a safe no-op for contacts that
 * already opted out, already have a stop/replied tag, or are already enrolled.
 */
export async function importContactsFromCsv(csvContent: string): Promise<ImportReport> {
  const rows = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true }) as CsvImportRow[];

  const report: ImportReport = { totalRows: rows.length, created: 0, updated: 0, enrolled: 0, skipped: [], noActiveCampaign: false };

  const defaultCampaign = await prisma.campaign.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  report.noActiveCampaign = !defaultCampaign;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const rawPhone = row.Phone ?? '';
    const normalized = normalizePhoneToE164(rawPhone);

    if (!normalized.valid || !normalized.e164) {
      report.skipped.push({ row: i + 1, reason: `invalid phone: ${rawPhone}`, phone: rawPhone });
      continue;
    }

    const data = {
      name: row['Contact Name'] || null,
      companyName: row['Company Name'] || null,
      phoneOriginal: rawPhone,
      city: row.City || null,
      website: row.Website || null,
      category: row.Category || null,
      rating: toFloat(row.Rating),
      reviewsCount: toInt(row['Reviews Count']),
      about: row.About || null,
      reviewSample: row['Review Sample'] || null,
      reviewSampleRating: toFloat(row['Review Sample Rating']),
      sourceQuery: row['Source Query'] || null,
      mapsRank: toInt(row['Maps Rank']),
      mapsUrl: row['Maps URL'] || null,
      placeId: row['Place ID'] || null,
      address: row.Address || null,
      source: row.Source || null,
    };

    const existing = await prisma.contact.findUnique({ where: { phoneE164: normalized.e164 } });
    const newCustomFields = extractCustomFields(row);
    const existingCustomFields =
      existing?.customFields && typeof existing.customFields === 'object' && !Array.isArray(existing.customFields)
        ? (existing.customFields as Record<string, unknown>)
        : {};
    const mergedCustomFields = { ...existingCustomFields, ...newCustomFields };
    const dataWithCustomFields =
      Object.keys(newCustomFields).length > 0
        ? { ...data, customFields: mergedCustomFields as Prisma.InputJsonValue }
        : data;

    let contactId: string;
    if (existing) {
      await prisma.contact.update({ where: { id: existing.id }, data: dataWithCustomFields });
      contactId = existing.id;
      report.updated += 1;
    } else {
      const created = await prisma.contact.create({ data: { ...dataWithCustomFields, phoneE164: normalized.e164 } });
      contactId = created.id;
      report.created += 1;
    }

    const tags = (row.Tags ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const tag of tags) {
      await addTag(contactId, tag);
    }

    // Auto-enroll: every imported contact is ready-for-outreach by default so
    // it shows up on the Kanban board without a manual "outreach-ready" step.
    await addTag(contactId, 'outreach-ready');
    if (defaultCampaign) {
      const result = await enrollContactInCampaign(contactId, defaultCampaign.id);
      if (result.enrolled) report.enrolled += 1;
    }
  }

  await writeAuditLog('CSV_IMPORT', {
    details: {
      totalRows: report.totalRows,
      created: report.created,
      updated: report.updated,
      enrolled: report.enrolled,
      skippedCount: report.skipped.length,
      noActiveCampaign: report.noActiveCampaign,
    },
  });

  return report;
}
