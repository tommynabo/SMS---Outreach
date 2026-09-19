import { parse } from 'csv-parse/sync';
import { prisma } from '../db/client';
import { normalizePhoneToE164 } from '../lib/phone';
import { addTag } from './tags';
import { writeAuditLog } from './auditLog';

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

export interface ImportReport {
  totalRows: number;
  created: number;
  updated: number;
  skipped: Array<{ row: number; reason: string; phone?: string }>;
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
 */
export async function importContactsFromCsv(csvContent: string): Promise<ImportReport> {
  const rows = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true }) as CsvImportRow[];

  const report: ImportReport = { totalRows: rows.length, created: 0, updated: 0, skipped: [] };

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

    let contactId: string;
    if (existing) {
      await prisma.contact.update({ where: { id: existing.id }, data });
      contactId = existing.id;
      report.updated += 1;
    } else {
      const created = await prisma.contact.create({ data: { ...data, phoneE164: normalized.e164 } });
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
  }

  await writeAuditLog('CSV_IMPORT', { details: { totalRows: report.totalRows, created: report.created, updated: report.updated, skippedCount: report.skipped.length } });

  return report;
}
