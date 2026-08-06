const normalizeLanguage = value => String(value || 'en-US').trim().replace('_', '-');

export const normalizeResumeLanguage = value => {
  const language = normalizeLanguage(value);
  if (/^zh(?:-|$)/i.test(language)) return 'zh-CN';
  if (/^en(?:-|$)/i.test(language)) return 'en-US';
  return language || 'en-US';
};

export const resolveProfileContact = (profile, language = 'en-US') => {
  const normalized = normalizeResumeLanguage(language);
  const localized = profile?.localizedContacts && typeof profile.localizedContacts === 'object'
    ? profile.localizedContacts
    : {};
  const exact = localized[normalized] || {};
  const baseLanguage = normalized.split('-')[0].toLowerCase();
  const base = Object.entries(localized)
    .find(([key]) => normalizeResumeLanguage(key).split('-')[0].toLowerCase() === baseLanguage)?.[1] || {};
  return {
    language: normalized,
    email: exact.email || base.email || profile?.email || null,
    phone: exact.phone || base.phone || profile?.phone || null,
  };
};
