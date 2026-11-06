// Provider errors can echo key fragments: strip env secrets and key-shaped tokens before anything is logged or shown.
export function redact(input: string): string {
  let out = String(input);
  for (const [name, value] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|DIRECT_URL/i.test(name) && value && value.length >= 8) out = out.split(value).join('[redacted]');
  }
  return out.replace(/\b(?:sk|gsk)[-_][\w-]{16,}/g, '[redacted]');
}
