export interface TemplateContext {
  company_name?: string | null;
  name?: string | null;
  source_query?: string | null;
  rating?: number | string | null;
  reviews_count?: number | string | null;
  city?: string | null;
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
