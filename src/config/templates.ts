// Default placeholder copy. Editable later from DB (message_templates table) via admin panel.
// These are seeded once; admin can edit content without touching code.
// Variables supported: {{company_name}} {{name}} {{source_query}} {{rating}} {{reviews_count}} {{city}}

export interface DefaultTemplate {
  actionType: 'INITIAL' | 'FOLLOWUP_1' | 'FOLLOWUP_2';
  variant: 'A' | 'B' | 'C';
  body: string;
}

// VARIANTE A: pain / oportunidad / evitar perder consultas
// VARIANTE B: contexto de búsqueda Google / source_query
// VARIANTE C: rating + número de reviews
export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    actionType: 'INITIAL',
    variant: 'A',
    body: 'Hola, soy [TU_NOMBRE]. He visto {{company_name}} en {{city}} y creo que podrías estar perdiendo clientes por no responder a tiempo. ¿Te interesa que hablemos 5 minutos? [PLACEHOLDER_COPY_A]',
  },
  {
    actionType: 'FOLLOWUP_1',
    variant: 'A',
    body: 'Hola de nuevo, ¿pudiste ver mi mensaje anterior sobre {{company_name}}? [PLACEHOLDER_FOLLOWUP_1_A]',
  },
  {
    actionType: 'FOLLOWUP_2',
    variant: 'A',
    body: 'Última vez que te escribo por aquí sobre {{company_name}}, si no te interesa lo entiendo perfectamente. [PLACEHOLDER_FOLLOWUP_2_A]',
  },
  {
    actionType: 'INITIAL',
    variant: 'B',
    body: 'Hola, buscando "{{source_query}}" en {{city}} encontré {{company_name}}. [PLACEHOLDER_COPY_B]',
  },
  {
    actionType: 'FOLLOWUP_1',
    variant: 'B',
    body: 'Hola, seguimos disponibles para hablar sobre {{company_name}} y lo de "{{source_query}}". [PLACEHOLDER_FOLLOWUP_1_B]',
  },
  {
    actionType: 'FOLLOWUP_2',
    variant: 'B',
    body: 'Último aviso: si te interesa lo de "{{source_query}}" para {{company_name}}, contesta a este SMS. [PLACEHOLDER_FOLLOWUP_2_B]',
  },
  {
    actionType: 'INITIAL',
    variant: 'C',
    body: 'Hola, vi que {{company_name}} tiene {{rating}}★ con {{reviews_count}} reseñas. [PLACEHOLDER_COPY_C]',
  },
  {
    actionType: 'FOLLOWUP_1',
    variant: 'C',
    body: 'Hola de nuevo, con {{reviews_count}} reseñas y {{rating}}★ seguro podemos ayudarte a conseguir más. [PLACEHOLDER_FOLLOWUP_1_C]',
  },
  {
    actionType: 'FOLLOWUP_2',
    variant: 'C',
    body: 'Último mensaje: si {{company_name}} quiere seguir creciendo esas {{reviews_count}} reseñas, contesta. [PLACEHOLDER_FOLLOWUP_2_C]',
  },
];
