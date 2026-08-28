import { normalizeResumeLanguage, resolveProfileContact } from '../../../lib/profile-contact.mjs';

const SECTION_LABELS = {
  'en-US': {
    education: 'Education',
    skills: 'Skills',
    experience: 'Working Experience',
    projects: 'Projects',
  },
  'zh-CN': {
    education: '教育背景',
    skills: '专业技能',
    experience: '工作经历',
    projects: '项目经历',
  },
};

const CATEGORY_LABELS_ZH = {
  'Programming Languages': '编程语言',
  'AI/ML & Agent Systems': 'AI/ML 与智能体系统',
  'Backend & APIs': '后端与接口',
  'Databases & Storage': '数据库与存储',
  'Infrastructure & Cloud': '基础设施与云',
  'Frameworks & Developer Tools': '框架与开发工具',
  'Tools & Technologies': '工具与技术',
  'Relevant Skills': '相关技能',
  'Additional Relevant Skills': '其他相关技能',
};

const escapeTex = value => String(value || '')
  .replace(/\\/g, '\\textbackslash{}')
  .replace(/([&%#_$])/g, '\\$1');

const escapeUrl = value => String(value || '').replace(/([%#])/g, '\\$1');

const HEADER_ESCAPES = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  '#': '\\#',
  '_': '\\_',
  '$': '\\$',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '{': '\\{',
  '}': '\\}',
};

const escapeHeaderText = value => String(value ?? '')
  .replace(/[\\&%#_$~^{}]/g, character => HEADER_ESCAPES[character]);

const sectionLabels = language =>
  SECTION_LABELS[normalizeResumeLanguage(language)] || SECTION_LABELS['en-US'];

const localized = (entry, language) => {
  const normalized = normalizeResumeLanguage(language);
  const variants = entry?.localized && typeof entry.localized === 'object'
    ? entry.localized
    : {};
  const exact = variants[normalized] || {};
  const baseLanguage = normalized.split('-')[0].toLowerCase();
  const base = Object.entries(variants)
    .find(([key]) => normalizeResumeLanguage(key).split('-')[0].toLowerCase() === baseLanguage)?.[1] || {};
  return { ...entry, ...base, ...exact };
};

const sectionPattern = label => new RegExp(
  `\\\\section\\s*\\{\\s*(?:\\\\textbf\\s*\\{\\s*)?${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}?\\s*\\}`,
  'i',
);

const sectionLeadingSpacer = (template, label, fallback) => {
  const match = String(template).match(sectionPattern(label));
  if (!match || match.index === undefined) return fallback;
  const before = template.slice(0, match.index);
  return before.match(/\\vspace\{([^}]+)\}\s*$/)?.[1]?.trim() || fallback;
};

const projectTransitionSpacer = (template, label) => {
  const section = String(template).match(sectionPattern(label));
  if (!section || section.index === undefined) return '-9mm';
  return template.slice(section.index + section[0].length).match(
    /\\resumeSubHeadingListEnd\s*\\vspace\{([^}]+)\}\s*\\resumeSubHeadingListStart/,
  )?.[1]?.trim() || '-9mm';
};

const documentHeader = template => {
  const marker = '\\begin{document}';
  const start = template.indexOf(marker);
  if (start === -1) throw new Error('managed template is missing \\begin{document}');
  const body = template.slice(start);
  const firstSection = body.search(/\\section\s*\{/);
  if (firstSection === -1) throw new Error('managed template is missing resume sections');
  return body.slice(0, firstSection);
};

const githubRepoRoot = value => {
  const match = String(value || '').match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/i);
  return match ? `https://github.com/${match[1]}/${match[2].replace(/\.git$/i, '')}` : null;
};

const entryUrl = (entry, bullets) => {
  if (entry.url) return entry.url;
  const source = bullets.map(item => item.source).find(Boolean);
  return githubRepoRoot(source) || source || '';
};

const bulletText = (bullet, language) => {
  if (normalizeResumeLanguage(language) === 'zh-CN') {
    if (!bullet.textZh?.trim()) {
      throw new Error(`selected bullet ${bullet.id || '<unknown>'} has no reviewed Chinese textZh`);
    }
    return bullet.textZh;
  }
  return bullet.text;
};

const itemList = (bullets, language) => [
  '    \\resumeItemListStart',
  // The bullet body is the one field that reached LaTeX unescaped: a reviewed
  // bullet saying "cut p99 latency by 62%" commented out its own closing brace.
  // judgeResume's unescapeTex is the exact inverse, so verbatim still compares
  // the reviewed source.
  ...bullets.map(bullet => `      \\resumeItem{}{${escapeTex(bulletText(bullet, language))}}`),
  '    \\resumeItemListEnd',
].join('\n');

const subheadingBlock = (args, bullets, language) => [
  '\\resumeSubHeadingListStart',
  '  \\resumeSubheading',
  ...args.map(value => `    {${value}}`),
  itemList(bullets, language),
  '\\resumeSubHeadingListEnd',
].join('\n');

const descriptorRows = profile => {
  const rows = [];
  for (const [index, entry] of (profile.experience || []).entries()) {
    rows.push({
      key: `experience:${index}`,
      kind: 'experience',
      entry,
      origin: `experience · ${[entry.company, entry.title].filter(Boolean).join(' — ')}`,
    });
  }
  for (const [index, entry] of (profile.projects || []).entries()) {
    rows.push({
      key: `project:${index}`,
      kind: 'project',
      entry,
      origin: `project · ${entry.name || ''}`,
    });
  }
  for (const [sectionIndex, section] of (profile.customSections || []).entries()) {
    for (const [entryIndex, entry] of (section.entries || []).entries()) {
      rows.push({
        key: `custom:${sectionIndex}:${entryIndex}`,
        kind: 'custom',
        section,
        entry,
        origin: `${section.title || 'custom'} · ${entry.heading || ''}`,
      });
    }
  }
  return rows;
};

const groupSelectedBullets = (profile, bullets) => {
  const descriptors = descriptorRows(profile);
  const byOrigin = new Map(descriptors.map(row => [row.origin, row]));
  const byText = new Map();
  for (const row of descriptors) {
    for (const bullet of row.entry.description || []) {
      const text = String(typeof bullet === 'string' ? bullet : bullet?.text || '').trim();
      if (text && !byText.has(text)) byText.set(text, row);
    }
  }
  const groups = new Map();
  for (const bullet of bullets) {
    const descriptor = byOrigin.get(bullet.origin) || byText.get(String(bullet.text || '').trim());
    if (!descriptor) throw new Error(`selected bullet ${bullet.id} no longer maps to a profile entry`);
    if (!groups.has(descriptor.key)) groups.set(descriptor.key, { ...descriptor, bullets: [] });
    groups.get(descriptor.key).bullets.push(bullet);
  }
  return [...groups.values()];
};

export const consolidatedSkillGroups = skills => {
  const byLabel = new Map();
  for (const skill of skills) {
    const label = String(skill.category || 'Tools & Technologies').trim();
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(String(skill.name || '').trim());
  }
  const active = [...byLabel].map(([label, names]) => ({ label, names }));
  const minimum = Math.min(5, skills.length);
  const sparse = active.filter(group => group.names.length < minimum);
  if (sparse.length === active.length && active.length > 1) {
    return [{ label: 'Relevant Skills', names: active.flatMap(group => group.names) }];
  }
  if (sparse.length) {
    const names = sparse.flatMap(group => group.names);
    active.splice(0, active.length, ...active.filter(group => !sparse.includes(group)));
    if (names.length >= minimum) {
      active.push({ label: 'Additional Relevant Skills', names });
    } else {
      const target = active.sort((a, b) => a.names.length - b.names.length)[0];
      target.names.push(...names);
      target.label = `${target.label} & Additional Skills`;
    }
  }
  return active;
};

export const localizedSkillGroups = (skills, language) => {
  const normalized = normalizeResumeLanguage(language);
  return consolidatedSkillGroups(skills).map(group => ({
    ...group,
    label: normalized === 'zh-CN' ? CATEGORY_LABELS_ZH[group.label] || group.label : group.label,
  }));
};

export const localizeResumeTemplate = (template, profile, language, options = {}) => {
  const normalized = normalizeResumeLanguage(language);
  const contact = resolveProfileContact(profile, normalized);
  let localizedTemplate = String(template);
  const header = documentHeader(localizedTemplate);
  let localizedHeader = header;

  if (contact.phone) {
    for (const scheme of ['sms', 'tel']) {
      localizedHeader = localizedHeader.replaceAll(
        `\\href{${scheme}:{phone}}{{phone}}`,
        `\\href{${scheme}:${escapeUrl(contact.phone)}}{${escapeHeaderText(contact.phone)}}`,
      );
    }
  }
  if (contact.email) {
    localizedHeader = localizedHeader.replaceAll(
      '\\href{mailto:{email}}{{email}}',
      `\\href{mailto:${escapeUrl(contact.email)}}{${escapeHeaderText(contact.email)}}`,
    );
  }

  const replaceHref = (schemes, value) => {
    if (!value) return;
    const schemePattern = schemes.join('|');
    localizedHeader = localizedHeader.replace(
      new RegExp(`\\\\href\\{(${schemePattern}):[^{}]*\\}\\{[^{}]*\\}`, 'g'),
      (_, scheme) => `\\href{${scheme}:${escapeUrl(value)}}{${escapeHeaderText(value)}}`,
    );
  };
  replaceHref(['sms', 'tel'], contact.phone);
  replaceHref(['mailto'], contact.email);

  if (contact.phone) {
    const phone = escapeHeaderText(contact.phone);
    localizedHeader = localizedHeader
      .replace(/(\\small\s*\{)\s*[^|{}]*(?=\|)/g, (_, prefix) => `${prefix}${phone}`)
      .replace(/^(\s*)[^|{}\n]*(?=\|\\href\{mailto:)/gm, (_, indent) => `${indent}${phone}`);
  }

  const values = {
    name: profile.name,
    phone: contact.phone,
    email: contact.email,
    linkedin: profile.linkedin,
    github: profile.github,
    website: profile.website,
    location: profile.location,
    title: profile.title,
  };
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) {
      localizedHeader = localizedHeader.replaceAll(`{${name}}`, escapeHeaderText(value));
    }
  }
  localizedTemplate = localizedTemplate.replace(header, localizedHeader);
  if (normalized !== 'zh-CN') return localizedTemplate;
  const cjkFont = String(options.cjkFont || (process.platform === 'darwin'
    ? 'Songti SC'
    : 'Noto Serif CJK SC')).replace(/[{}]/g, '');
  localizedTemplate = localizedTemplate
    .replace(
      /\\usepackage\[T1\]\{fontenc\}/,
      `\\usepackage{fontspec}\n\\usepackage{xeCJK}\n\\setCJKmainfont{${cjkFont}}`,
    )
    .replace(/Personal Web/g, '个人主页');
  const english = SECTION_LABELS['en-US'];
  const chinese = SECTION_LABELS['zh-CN'];
  for (const key of Object.keys(english)) {
    localizedTemplate = localizedTemplate.replace(
      new RegExp(`(\\\\section\\s*\\{\\s*(?:\\\\textbf\\s*\\{\\s*)?)${english[key]}(\\s*\\}?\\s*\\})`, 'gi'),
      `$1${chinese[key]}$2`,
    );
  }
  return localizedTemplate;
};

export const assembleResumeTex = ({ template, profile, match, language, cjkFont = null }) => {
  const normalized = normalizeResumeLanguage(language || match.resumeLanguage);
  const labels = sectionLabels(normalized);
  const localizedTemplate = localizeResumeTemplate(template, profile, normalized, { cjkFont });
  const marker = '\\begin{document}';
  const preambleEnd = localizedTemplate.indexOf(marker);
  if (preambleEnd === -1) throw new Error('managed template is missing \\begin{document}');
  const preamble = localizedTemplate.slice(0, preambleEnd);
  const groups = groupSelectedBullets(profile, match.bullets || []);
  const experience = groups.filter(group => group.kind === 'experience');
  const projects = groups.filter(group => group.kind === 'project');
  const custom = groups.filter(group => group.kind === 'custom');
  const lines = [preamble + documentHeader(localizedTemplate)];

  lines.push(`\\section{\\textbf{${labels.education}}}`, '\\vspace{-0.4mm}', '\\resumeSubHeadingListStart');
  (profile.education || []).forEach((raw, index, all) => {
    const entry = localized(raw, normalized);
    lines.push(
      '\\resumeSubheading',
      `{${escapeTex(entry.institution)}}{${escapeTex(entry.date)}}`,
      `{${escapeTex(entry.degree)}}{${escapeTex(entry.location)}}`,
    );
    if (index < all.length - 1) lines.push('\\vspace{-3mm}');
  });
  lines.push('\\resumeSubHeadingListEnd');

  lines.push(
    `\\vspace{${sectionLeadingSpacer(localizedTemplate, labels.skills, '-9mm')}}`,
    `\\section{\\textbf{${labels.skills}}}`,
    '\\resumeHeadingSkillStart',
  );
  const skillGroups = localizedSkillGroups(match.skills || [], normalized);
  skillGroups.forEach((group, index) => {
    lines.push(
      `\\resumeSubItem{${escapeTex(group.label)}:}`,
      `  {${group.names.map(escapeTex).join(', ')}}`,
    );
    if (index < skillGroups.length - 1) lines.push('\\vspace{-1mm}');
  });
  lines.push('\\resumeHeadingSkillEnd');

  const renderExperience = group => {
    const entry = localized(group.entry, normalized);
    return subheadingBlock([
      escapeTex(entry.company),
      escapeTex(entry.date),
      escapeTex(entry.title),
      escapeTex(entry.location),
    ], group.bullets, normalized);
  };
  const renderProject = group => {
    const entry = localized(group.entry, normalized);
    const url = entryUrl(entry, group.bullets);
    const link = url ? `\\href{${escapeUrl(url)}}{${escapeUrl(url)}}` : '';
    return subheadingBlock([
      escapeTex(entry.name),
      escapeTex(entry.role || entry.technologies || ''),
      link,
      escapeTex(entry.dateRange || entry.date || ''),
    ], group.bullets, normalized);
  };
  const transition = projectTransitionSpacer(localizedTemplate, labels.projects);

  if (experience.length) {
    lines.push(
      `\\vspace{${sectionLeadingSpacer(localizedTemplate, labels.experience, '-5mm')}}`,
      `\\section{\\textbf{${labels.experience}}}`,
    );
    experience.forEach((group, index) => {
      if (index) lines.push(`\\vspace{${transition}}`);
      lines.push(renderExperience(group));
    });
  }

  if (projects.length) {
    lines.push(experience.length ? '\\resumeSectionTransition' : '\\vspace{-5mm}');
    lines.push(`\\section{\\textbf{${labels.projects}}}`, '\\vspace{-1mm}');
    projects.forEach((group, index) => {
      if (index) lines.push(`\\vspace{${transition}}`);
      lines.push(renderProject(group));
    });
  }

  for (const group of custom) {
    const section = localized(group.section, normalized);
    const entry = localized(group.entry, normalized);
    lines.push(
      `\\vspace{${transition}}`,
      `\\section{\\textbf{${escapeTex(section.title || group.section.title || 'Additional Experience')}}}`,
      subheadingBlock([
        escapeTex(entry.heading),
        '',
        escapeTex(entry.subheading),
        escapeTex(entry.date),
      ], group.bullets, normalized),
    );
  }

  lines.push(`\\vspace{${transition}}`, '', '\\end{document}', '');
  return {
    tex: lines.join('\n'),
    language: normalized,
    bulletCount: (match.bullets || []).length,
    skillCount: (match.skills || []).length,
    entryCount: groups.length,
  };
};

export const resumeSectionLabels = sectionLabels;
export const escapeResumeText = escapeTex;
