// Shared, agent-neutral skill naming metadata. This classifies skills for
// profile, Tier 0, and campaign display; it never decides whether a skill is
// eligible or relevant to a particular JD.

export const SKILL_CATEGORIES = {
  'Programming Languages': [
    'Python', 'Go', 'Rust', 'C++', 'C', 'Java', 'Kotlin', 'Swift',
    'TypeScript', 'JavaScript', 'SQL', 'Shell', 'Ruby', 'Objective-C',
  ],
  'AI/ML & Agent Systems': [
    'Agentic Loops', 'RAG', 'Multi-Agent Orchestration', 'LLM Tool Calling',
    'Model Context Protocol (MCP)', 'LiteLLM', 'Prompt Engineering',
    'PyTorch', 'AI SDK',
  ],
  'Backend & APIs': [
    'Spring Boot', 'Node.js', 'NestJS', 'Flask', 'gRPC', 'REST APIs',
    'RESTful APIs', 'GraphQL', 'Apollo', 'WebSocket',
  ],
  'Distributed Systems & Data': [
    'Apache Kafka', 'Apache Spark', 'HDFS', 'BigQuery',
    'Distributed Consensus', 'Event-Driven Architecture', 'Fault Tolerance',
  ],
  'Infrastructure & Cloud': [
    'Docker', 'AWS', 'S3', 'Secrets Manager', 'Traefik', 'CI/CD',
    'GitHub Actions', 'Kubernetes', 'Windows',
  ],
  'Databases & Storage': [
    'PostgreSQL', 'MySQL', 'Redis', 'Cassandra', 'SQLite',
  ],
  'Frameworks & Developer Tools': [
    'React', 'Tauri', 'Electron', 'Expo', 'Maestro', 'Bun', 'PureTUI',
    'PTY', 'Git Worktrees', 'HTML', 'CSS', 'Markdown', 'MDX', 'YAML',
    'Handlebars',
  ],
};

const CATEGORY_MEMBERS = new Map(Object.entries(SKILL_CATEGORIES)
  .flatMap(([category, names]) => names.map(name => [name.toLowerCase(), category])));

export const inferSkillCategory = name =>
  CATEGORY_MEMBERS.get(String(name || '').trim().toLowerCase()) ||
  'Tools & Technologies';
