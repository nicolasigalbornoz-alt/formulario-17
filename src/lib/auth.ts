// Auth mínima para el panel admin: una sola contraseña compartida (secret
// ADMIN_PASSWORD_HASH), sesión con cookie firmada por HMAC (secret
// SESSION_SECRET). Sin usuarios ni base de datos: alcanza para un panel
// interno de un solo rol.

const SESSION_COOKIE = "f17_admin";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12hs

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toHex(sig);
}

export async function checkPassword(password: string, adminPasswordHash: string): Promise<boolean> {
  const hash = await sha256Hex(password);
  return hash === adminPasswordHash;
}

export async function createSessionCookieValue(secret: string): Promise<string> {
  const issuedAt = Date.now().toString();
  const sig = await hmacHex(issuedAt, secret);
  return `${issuedAt}.${sig}`;
}

export async function isValidSession(cookieValue: string | undefined, secret: string): Promise<boolean> {
  if (!cookieValue) return false;
  const [issuedAt, sig] = cookieValue.split(".");
  if (!issuedAt || !sig) return false;
  if (Date.now() - Number(issuedAt) > SESSION_MAX_AGE_MS) return false;
  const expected = await hmacHex(issuedAt, secret);
  return expected === sig;
}

export const ADMIN_SESSION_COOKIE = SESSION_COOKIE;
