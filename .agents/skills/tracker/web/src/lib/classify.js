// Hardcoded keyword classifier for job postings.
// ponytail: an LLM tagging pass can replace this when precision matters.
export const LEVELS = [
  ['internship', 'Internship'],
  ['newgrad', 'New Grad / Full-time'],
  ['any', 'Both'],
];

export const DIRS = [
  ['frontend', 'Frontend', /front.?end|\bui\b|web develop/i],
  ['backend', 'Backend', /back.?end|\bapi\b|server|distributed|microservice/i],
  ['fullstack', 'Full-Stack', /full.?stack/i],
  ['mobile', 'Mobile', /mobile|\bios\b|android/i],
  ['ai-ml', 'AI / ML', /machine learning|\bml\b|\bai\b|deep learning|\bllm\b|computer vision|\bnlp\b|data scien|perception/i],
  ['data', 'Data Eng', /data engineer|analytics|\betl\b|data platform/i],
  ['infra', 'Infra / Cloud', /infrastructure|cloud|devops|\bsre\b|kubernetes|reliability|platform engineer/i],
  ['security', 'Security', /security|appsec|crypto/i],
  ['embedded', 'Embedded / Systems', /embedded|firmware|kernel|systems software|silicon|hardware/i],
  ['qa', 'QA / Test', /\bqa\b|quality|test engineer/i],
  ['general', 'General SWE', null],
];

export const levelOf = job =>
  /\bintern(ship)?s?\b/i.test(job.role) ? 'internship' : 'newgrad';

export const dirsOf = job => {
  const hit = DIRS.filter(([, , re]) => re && re.test(job.role)).map(([k]) => k);
  return hit.length ? hit : ['general'];
};

export const STATUS_COLUMNS = [
  ['pending', 'To Apply', 'var(--color-warn)'],
  ['applied', 'Applied', 'var(--color-ok)'],
  ['interviewing', 'Interviewing', 'var(--color-info)'],
  ['offer', 'Offer', 'oklch(84% 0.12 136)'],
  ['rejected', 'Rejected', 'var(--color-dim)'],
];

const hostOf = homepage => {
  try {
    return homepage ? new URL(homepage).hostname : null;
  } catch {
    return null;
  }
};

// logo chain: logo.dev (when the user configured a publishable token) →
// Google favicon service → null (caller renders an initials tile).
export const faviconFor = (homepage, logoDevToken = null) => {
  const host = hostOf(homepage);
  if (!host) return null;
  if (logoDevToken) return `https://img.logo.dev/${host}?token=${encodeURIComponent(logoDevToken)}&size=64&retina=true`;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
};

export const faviconFallback = homepage => {
  const host = hostOf(homepage);
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : null;
};

// deterministic Hallmark-ish hue per company for the initials tile
export const tileHue = name => {
  let h = 0;
  for (const ch of String(name || '?')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
};
