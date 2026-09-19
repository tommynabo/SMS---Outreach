import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { importContactsFromCsv } from '../../../services/csvImport';

const importSchema = z.object({ csv: z.string().min(1) });

export async function registerCsvRoutes(app: FastifyInstance): Promise<void> {
  app.post('/import-csv', async (request) => {
    const body = importSchema.parse(request.body);
    const report = await importContactsFromCsv(body.csv);
    return report;
  });
}
