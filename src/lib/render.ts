export interface TemplateContext {
  company_name?: string | null;
  name?: string | null;
  source_query?: string | null;
  rating?: number | string | null;
  reviews_count?: number | string | null;
  city?: string | null;
  // Extra variables discovered from CSV columns with no first-class field
  // (see Contact.customFields), e.g. {{google_reviews_text}}.
  [key: string]: unknown;
}

/**
 * Merges a contact's free-form customFields (JSON column) with the fixed,
 * well-known template variables. Fixed variables always win on key collision.
 */
export function buildTemplateContext(customFields: unknown, fixed: Record<string, unknown>): TemplateContext {
  const custom = customFields && typeof customFields === 'object' && !Array.isArray(customFields) ? (customFields as Record<string, unknown>) : {};
  return { ...custom, ...fixed };
}

/**
 * Renders a message template. Unknown/missing variables are replaced with an
 * empty string rather than left as literal "{{...}}" text sent to a real prospect.
 */
export function renderTemplate(body: string, context: TemplateContext): string {
  return body.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) => {
    const value = (context as Record<string, unknown>)[key];
    if (value === null || value === undefined) return '';
    return String(value);
  });
}
