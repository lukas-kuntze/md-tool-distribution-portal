/**
 * Diagnostic log. Context values must not contain personal data such as logins, IP addresses or free text
 * entered by users; refer to records by their identifiers. Personal data belongs in the audit log only.
 */
export interface Logger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
}
