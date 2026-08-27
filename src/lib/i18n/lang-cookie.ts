// Deliberately dependency-free (no prisma/auth imports) so both the
// server-side getLang() and the client-side getClientLang() can share this
// constant without dragging server-only code into a client bundle.
export const LANG_COOKIE = "diva_lang";
