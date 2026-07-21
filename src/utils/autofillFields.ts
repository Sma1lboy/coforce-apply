// Pure field-matching logic for tier-1 application auto-fill.
// No DOM / browser APIs here — the harness runs this directly in Node
// (node --experimental-strip-types), the content script wires it to the page.

export type ProfileLike = {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  website?: string;
};

export const FIELD_PATTERNS: [
  RegExp,
  (p: ProfileLike) => string | undefined,
][] = [
  [/first[\s_-]?name|given[\s_-]?name/i, p => p.name?.split(/\s+/)[0]],
  [
    /last[\s_-]?name|family[\s_-]?name|surname/i,
    p => p.name?.split(/\s+/).slice(1).join(' '),
  ],
  [/full[\s_-]?name|^name$|your[\s_-]?name|legal[\s_-]?name/i, p => p.name],
  [/e-?mail/i, p => p.email],
  [/phone|mobile|^tel/i, p => p.phone],
  [/linked[\s_-]?in/i, p => p.linkedin],
  [/git[\s_-]?hub/i, p => p.github],
  [/website|portfolio|personal[\s_-]?site/i, p => p.website],
  [/location|city|address/i, p => p.location],
];

/**
 * Resolve the profile value for a form field given its descriptor text
 * (label + name + id + placeholder + aria-label + autocomplete, joined).
 * Returns undefined when no pattern matches or the profile lacks the value.
 */
export function resolveFieldValue(
  descriptor: string,
  profile: ProfileLike
): string | undefined {
  const match = FIELD_PATTERNS.find(([pattern]) => pattern.test(descriptor));
  const value = match?.[1](profile);
  return value || undefined;
}
