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
    body: 'Hola, he visto {{company_name}} en {{city}} y creo que podrías estar perdiendo clientes por no responder a tiempo. ¿Te interesa que hablemos 5 minutos?',
  },
  {
    actionType: 'FOLLOWUP_1',
    variant: 'A',
    body: 'Hola de nuevo, ¿pudiste ver mi mensaje anterior sobre {{company_name}}? Sigo disponible si quieres que hablemos.',
  },
  {
    actionType: 'FOLLOWUP_2',
    variant: 'A',
    body: 'Última vez que te escribo por aquí sobre {{company_name}}, si no te interesa lo entiendo perfectamente. Un saludo.',
  },
  {
    actionType: 'INITIAL',
    variant: 'B',
    body: 'Hola, buscando "{{source_query}}" en {{city}} encontré {{company_name}}. ¿Tenéis alguien encargado de responder a los clientes que os escriben?',
  },
  {
    actionType: 'FOLLOWUP_1',
    variant: 'B',
    body: 'Hola, seguimos disponibles para hablar sobre {{company_name}} y lo de "{{source_query}}". ¿Te viene bien esta semana?',
  },
  {
    actionType: 'FOLLOWUP_2',
    variant: 'B',
    body: 'Último aviso: si te interesa lo de "{{source_query}}" para {{company_name}}, contesta a este SMS. Si no, no te vuelvo a escribir.',
  },
  {
    actionType: 'INITIAL',
    variant: 'C',
    body: 'Hola, vi que {{company_name}} tiene {{rating}}★ con {{reviews_count}} reseñas. Trabajo ayudando a negocios como el tuyo a no perder clientes por tardar en responder. ¿Hablamos?',
  },
  {
    actionType: 'FOLLOWUP_1',
    variant: 'C',
    body: 'Hola de nuevo, con {{reviews_count}} reseñas y {{rating}}★ seguro podemos ayudarte a conseguir más clientes. ¿Te interesa que te cuente cómo?',
  },
  {
    actionType: 'FOLLOWUP_2',
    variant: 'C',
    body: 'Último mensaje: si {{company_name}} quiere seguir creciendo esas {{reviews_count}} reseñas, contesta. Si no, no te molesto más.',
  },
];
