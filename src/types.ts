import { z } from 'zod';

export interface UserProfile {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  summary?: string;
  skills?: string[];
  courses?: string[];
  experience?: {
    company: string;
    title: string;
    date: string;
    location?: string;
    description: { text: string; weight?: number }[];
    weight?: number;
  }[];
  education?: {
    institution: string;
    degree: string;
    date: string;
    location?: string;
    relevantCourses?: string;
  }[];
  certifications?: {
    name: string;
    issuer: string;
    date: string;
  }[];
  languages?: {
    language: string;
    proficiency: string;
  }[];
  projects?: {
    name: string;
    description: { text: string; weight?: number }[];
    technologies?: string;
    dateRange?: string;
    weight?: number;
  }[];
}

// A tracked job application. Status is the pipeline stage only; HOW delivery
// went (tier-1 failed, handed to Claude fallback) is recorded in `history` and
// the `needsFallback` flag, not as statuses. Local truth:
// profile/applications.json (synced with the extension via export/import).
export type JobApplicationStatus =
  | 'pending'
  | 'applied'
  | 'interviewing'
  | 'offer'
  | 'rejected';

export interface JobApplication {
  id: string;
  url: string;
  title: string;
  status: JobApplicationStatus;
  createdAt: string;
  updatedAt: string;
  company?: string;
  position?: string;
  notes?: string;
  /** Tier-1 auto-fill failed or stalled — hand this one to the Claude fallback */
  needsFallback?: boolean;
  /** Job description text saved when the application was tracked */
  description?: string;
  /** Application timeline: submissions, status changes, interviews */
  history?: { date: string; event: string }[];
}

// Define the OpenAI settings interface
export interface OpenAISettings {
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface UserProfileForm {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  website: string;
  summary: string;
  skills: string;
  courses: string;
  experience: string;
  education: string;
  certifications: string;
  languages: string;
  projects: string;
}

// Schema for UserProfile validation - Aligned with UserProfile interface
export const userProfileSchema = z.object({
  name: z.string().describe('Full name of the person').optional(), // Make basic info optional for schema
  title: z.string().describe('Professional title or role').optional(),
  email: z.string().describe('Email address').optional(),
  phone: z.string().describe('Phone number').optional(),
  location: z.string().describe('Location or address').optional(),
  linkedin: z.string().optional().describe('LinkedIn profile URL'),
  github: z.string().optional().describe('GitHub profile URL'),
  website: z.string().optional().describe('Personal website URL'),
  summary: z.string().describe('Professional summary or objective').optional(),
  skills: z.array(z.string()).describe('List of skills').optional(),
  courses: z
    .array(z.string())
    .optional()
    .describe('List of relevant courses taken'),
  experience: z
    .array(
      z.object({
        company: z.string().describe('Company name'),
        title: z.string().describe('Job title'),
        date: z
          .string()
          .describe('Employment period (e.g., "Jan 2020 - Present")'),
        location: z
          .string()
          .optional()
          .describe('Job location (e.g., "Sunnyvale, CA" or "Remote")'),
        description: z
          .array(
            z.object({
              text: z.string().describe('Responsibility or achievement text'),
              weight: z
                .number()
                .optional()
                .describe('Importance weight for this specific point'),
            })
          )
          .describe(
            'List of responsibilities and achievements with optional weights'
          ),
        weight: z
          .number()
          .optional()
          .describe('Overall importance weight for this experience item'),
      })
    )
    .optional() // Make experience optional in schema
    .describe('Work experience'),
  education: z
    .array(
      z.object({
        institution: z.string().describe('Educational institution name'),
        degree: z.string().describe('Degree or certification'),
        date: z.string().describe('Period of study (e.g., "2015 - 2019")'),
        location: z
          .string()
          .optional()
          .describe('Institution location (e.g., "Madison, WI")'),
        relevantCourses: z
          .string()
          .optional()
          .describe('Relevant courses taken'),
      })
    )
    .optional() // Make education optional in schema
    .describe('Educational background'),
  projects: z
    .array(
      z.object({
        name: z.string().describe('Project name'),
        description: z
          .array(
            z.object({
              text: z.string().describe('Project detail or achievement text'),
              weight: z
                .number()
                .optional()
                .describe('Importance weight for this specific point'),
            })
          )
          .describe(
            'List of project details and achievements with optional weights'
          ),
        technologies: z.string().optional().describe('Technologies used'),
        dateRange: z
          .string()
          .optional()
          .describe('Project duration (e.g., "Jan 2023 - Jun 2023")'),
        weight: z
          .number()
          .optional()
          .describe('Overall importance weight for this project item'),
      })
    )
    .optional()
    .describe('Personal or academic projects'),
  certifications: z
    .array(
      z.object({
        name: z.string().describe('Certification name'),
        issuer: z.string().describe('Certification issuer'),
        date: z.string().describe('Date of certification'),
      })
    )
    .optional()
    .describe('Professional certifications'),
  languages: z
    .array(
      z.object({
        language: z.string().describe('Language name'),
        proficiency: z
          .string()
          .describe('Proficiency level (e.g., "Fluent", "Intermediate")'),
      })
    )
    .optional()
    .describe('Language proficiency'),
});

// Schema for job metadata extraction
export const jobMetadataSchema = z.object({
  company: z
    .string()
    .describe('Company name extracted from job description or URL'),
  position: z
    .string()
    .describe('Job position/title extracted from job description'),
  industry: z.string().describe('Industry sector the job belongs to'),
  location: z.string().describe('Job location if mentioned'),
  keyRequirements: z
    .array(z.string())
    .describe('Key requirements or qualifications for the job'),
  keySkills: z
    .object({
      technical: z
        .record(z.array(z.string()))
        .optional()
        .describe(
          'Technical skills grouped by category (e.g. programming: [JavaScript, TypeScript])'
        ),
      soft: z
        .array(z.string())
        .optional()
        .describe('Soft skills like Communication, Leadership'),
      domain: z
        .array(z.string())
        .optional()
        .describe('Domain-specific skills like Financial Analysis'),
      tools: z.array(z.string()).optional().describe('Tools and platforms'),
      uncategorized: z
        .array(z.string())
        .optional()
        .describe('Skills that do not fit in other categories'),
    })
    .describe('Categorized key skills mentioned in the job description'),
});

export type JobMetadata = z.infer<typeof jobMetadataSchema>;
