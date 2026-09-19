import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../src/db/client';
import { resetDatabase, seedTemplates, createTestCampaign } from './helpers';
import { importContactsFromCsv } from '../../src/services/csvImport';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const CSV_HEADER = 'Contact Name,Phone,Company Name,City,Website,Category,Rating,Reviews Count,About,Review Sample,Review Sample Rating,Source Query,Maps Rank,Maps URL,Place ID,Address,Source,Tags';

describe('importContactsFromCsv', () => {
  it('creates a new contact with normalized phone', async () => {
    const csv = `${CSV_HEADER}\nJuan,612345678,Acme SL,Madrid,,,,,,,,,,,,,gmaps,outreach-ready`;
    const report = await importContactsFromCsv(csv);
    expect(report.created).toBe(1);
    const contact = await prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34612345678' } });
    expect(contact.companyName).toBe('Acme SL');
  });

  it('deduplicates by phone_e164 on re-import (no duplicate contact rows)', async () => {
    const csv = `${CSV_HEADER}\nJuan,612345678,Acme SL,Madrid,,,,,,,,,,,,,gmaps,outreach-ready`;
    await importContactsFromCsv(csv);
    const report2 = await importContactsFromCsv(csv);
    expect(report2.updated).toBe(1);
    expect(report2.created).toBe(0);

    const all = await prisma.contact.findMany({ where: { phoneE164: '+34612345678' } });
    expect(all).toHaveLength(1);
  });

  it('re-import never clears do_not_contact_sms or reply history', async () => {
    const csv = `${CSV_HEADER}\nJuan,612345678,Acme SL,Madrid,,,,,,,,,,,,,gmaps,outreach-ready`;
    await importContactsFromCsv(csv);

    const contact = await prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34612345678' } });
    await prisma.contact.update({
      where: { id: contact.id },
      data: { doNotContactSms: true, lastSmsReply: 'STOP', outreachStatus: 'STOPPED' },
    });

    const csvUpdated = `${CSV_HEADER}\nJuan,612345678,Acme SL v2,Barcelona,,,,,,,,,,,,,gmaps,outreach-ready`;
    await importContactsFromCsv(csvUpdated);

    const after = await prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34612345678' } });
    expect(after.doNotContactSms).toBe(true);
    expect(after.lastSmsReply).toBe('STOP');
    expect(after.outreachStatus).toBe('STOPPED');
    expect(after.companyName).toBe('Acme SL v2'); // non-destructive fields DO update
  });

  it('rejects invalid phone numbers without crashing the whole import', async () => {
    const csv = `${CSV_HEADER}\nBad,123,Acme SL,Madrid,,,,,,,,,,,,,gmaps,`;
    const report = await importContactsFromCsv(csv);
    expect(report.created).toBe(0);
    expect(report.skipped).toHaveLength(1);
  });

  it('auto-enrolls newly imported contacts into the active campaign (Kanban "Nuevo prospecto")', async () => {
    await seedTemplates();
    const campaign = await createTestCampaign();
    const csv = `${CSV_HEADER}\nJuan,612345678,Acme SL,Madrid,,,,,,,,,,,,,gmaps,`;

    const report = await importContactsFromCsv(csv);
    expect(report.enrolled).toBe(1);
    expect(report.noActiveCampaign).toBe(false);

    const contact = await prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34612345678' } });
    expect(contact.outreachStatus).toBe('ACTIVE');

    const pipelineEntry = await prisma.pipelineEntry.findUnique({
      where: { contactId_campaignId: { contactId: contact.id, campaignId: campaign.id } },
    });
    expect(pipelineEntry?.stage).toBe('NUEVO_PROSPECTO');

    const initialAction = await prisma.outreachAction.findFirst({ where: { contactId: contact.id, actionType: 'INITIAL' } });
    expect(initialAction).not.toBeNull();
  });

  it('reports noActiveCampaign and still imports contacts when there is no active campaign', async () => {
    const csv = `${CSV_HEADER}\nJuan,612345678,Acme SL,Madrid,,,,,,,,,,,,,gmaps,`;
    const report = await importContactsFromCsv(csv);
    expect(report.created).toBe(1);
    expect(report.enrolled).toBe(0);
    expect(report.noActiveCampaign).toBe(true);
  });

  it('captures unmapped CSV columns as customFields usable as template variables', async () => {
    const header = `${CSV_HEADER},Google Reviews Text`;
    const csv = `${header}\nJuan,612345678,Acme SL,Madrid,,,,,,,,,,,,,gmaps,,"Great service!"`;
    await importContactsFromCsv(csv);
    const contact = await prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34612345678' } });
    expect(contact.customFields).toEqual({ google_reviews_text: 'Great service!' });
  });
});
