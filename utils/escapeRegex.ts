// Escapes a user-supplied string so it matches literally inside a MongoDB
// $regex. Without this, a search box value is interpreted as a regular
// expression: it can throw on malformed input and an adversarial pattern can
// burn database CPU (ReDoS).
const escapeRegex = (input: string): string => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default escapeRegex;
