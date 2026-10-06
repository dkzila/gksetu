'use client'

/**
 * GKSetu — Console navigation config (CONSOLE-S1).
 *
 * The single source of truth for the sidebar: groups, items, icons, the
 * permission that gates each item's visibility (server re-checks every
 * operation regardless — §20), and the page metadata the header renders.
 */
import {
  BookOpen,
  BookOpenCheck,
  ChartColumn,
  ClipboardList,
  FileText,
  Files,
  FlaskConical,
  GraduationCap,
  History,
  Languages,
  LayoutDashboard,
  Link2,
  ListChecks,
  MessageCircleQuestion,
  Network,
  Newspaper,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  Timer,
  UserCircle,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface ConsoleNavItem {
  id: string
  label: string
  /** Path relative to /console ('' = the dashboard itself). */
  path: string
  icon: LucideIcon
  /** Nav visibility only — the server re-checks every operation (§20). */
  permission?: string
  description: string
}

export interface ConsoleNavGroup {
  id: string
  label: string
  items: ConsoleNavItem[]
}

export const CONSOLE_NAV: ConsoleNavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        path: '',
        icon: LayoutDashboard,
        description: 'Platform status, live counts and quick actions.',
      },
      {
        id: 'analytics',
        label: 'Analytics',
        path: 'analytics',
        icon: ChartColumn,
        permission: 'analytics:read',
        description: 'The §32 product families — growth, engagement, study, assessment, share, search.',
      },
      {
        id: 'audit',
        label: 'Audit log',
        path: 'audit',
        icon: ScrollText,
        permission: 'audit:read',
        description: 'Every privileged action, who took it, and what changed.',
      },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    items: [
      {
        id: 'posts',
        label: 'Posts',
        path: 'posts',
        icon: FileText,
        permission: 'content:manage',
        description: 'Knowledge & current-affairs representations — draft, review, schedule, publish.',
      },
      {
        id: 'current-affairs',
        label: 'Current Affairs',
        path: 'current-affairs',
        icon: Newspaper,
        permission: 'current-affairs:manage',
        description: 'The canonical event records — links to sources, entities, topics and units.',
      },
      {
        id: 'knowledge',
        label: 'Knowledge Units',
        path: 'knowledge',
        icon: BookOpen,
        permission: 'knowledge:manage',
        description: 'The canonical knowledge base every representation hangs from.',
      },
      {
        id: 'sources',
        label: 'Sources',
        path: 'sources',
        icon: Link2,
        permission: 'source:manage',
        description: 'The evidence registry — where every fact came from.',
      },
      {
        id: 'entities',
        label: 'Entities',
        path: 'entities',
        icon: Tags,
        permission: 'entities:manage',
        description: 'Persons, places, organisations and concepts the events reference.',
      },
      {
        id: 'translations',
        label: 'Translations',
        path: 'translations',
        icon: Languages,
        permission: 'translations:manage',
        description: 'The localisation pipeline — drift detection and AI drafts.',
      },
    ],
  },
  {
    id: 'assessment',
    label: 'Assessment',
    items: [
      {
        id: 'questions',
        label: 'Questions (MCQ)',
        path: 'questions',
        icon: ListChecks,
        permission: 'question:manage',
        description: 'The scored practice bank — one question, many contexts.',
      },
      {
        id: 'qna',
        label: 'Q&A',
        path: 'qna',
        icon: MessageCircleQuestion,
        permission: 'qna:manage',
        description: 'The QnA learning layer — question-and-answer knowledge checks.',
      },
      {
        id: 'pyq',
        label: 'PYQ',
        path: 'pyq',
        icon: History,
        permission: 'question:manage',
        description: 'Previous-year provenance — which exam, year and paper each question was asked in.',
      },
      {
        id: 'mock-tests',
        label: 'Mock Tests',
        path: 'mock-tests',
        icon: Timer,
        permission: 'mocktest:manage',
        description: 'Timed, sectioned tests assembled from the question bank.',
      },
      {
        id: 'exam-notes',
        label: 'Exam Notes',
        path: 'exam-notes',
        icon: Sparkles,
        permission: 'note:manage',
        description: 'The premium editorial overlay — Pattern Briefs, Cheat Sheets, Worked MCQs, Revision Notes for every chapter of every exam.',
      },
    ],
  },
  {
    id: 'exams',
    label: 'Exams & Structure',
    items: [
      {
        id: 'exams',
        label: 'Exams',
        path: 'exams',
        icon: GraduationCap,
        permission: 'exam:manage',
        description: 'Exams, versions, syllabus trees and knowledge mappings.',
      },
      {
        id: 'tutorials',
        label: 'Tutorials',
        path: 'tutorials',
        icon: BookOpenCheck,
        permission: 'exam:manage',
        description: 'The computed learning paths — per-exam coverage, gaps and learner progress.',
      },
      {
        id: 'taxonomy',
        label: 'Taxonomy',
        path: 'taxonomy',
        icon: Network,
        permission: 'taxonomy:manage',
        description: 'The one global topic framework with country extensions.',
      },
    ],
  },
  {
    id: 'site',
    label: 'Site',
    items: [
      {
        id: 'pages',
        label: 'Pages',
        path: 'pages',
        icon: Files,
        permission: 'pages:manage',
        description: 'About, Contact, Privacy Policy and any custom page — managed, published, footer-linked.',
      },
      {
        id: 'premium',
        label: 'Premium Access',
        path: 'premium',
        icon: ShieldCheck,
        permission: 'premium:manage',
        description: 'The entitlement registry that unlocks gated ExamNotes. Manage grants + the global gating switch (the "free for now" lever).',
      },
      {
        id: 'settings',
        label: 'Settings',
        path: 'settings',
        icon: Settings,
        permission: 'settings:manage',
        description: 'Integrations (Analytics, Search Console, ads.txt, FB pixel, API keys), countries & languages.',
      },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      {
        id: 'editorial',
        label: 'Editorial Board',
        path: 'editorial',
        icon: ClipboardList,
        permission: 'editorial:work',
        description: 'The task board — assign, claim, progress and resolve.',
      },
      {
        id: 'staff',
        label: 'Staff',
        path: 'staff',
        icon: Users,
        permission: 'staff:manage',
        description: 'Workspace members — invite with one-time passwords, scopes and roles.',
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      {
        id: 'account',
        label: 'Account',
        path: 'account',
        icon: UserCircle,
        description: 'Your profile, sessions and sign-out.',
      },
      {
        id: 'dev-track',
        label: 'Dev Track',
        path: 'dev-track',
        icon: FlaskConical,
        description: 'The preserved foundation console — every build-verification demo.',
      },
    ],
  },
]

/** The console page for a nav id — the header's title/description source. */
export function findNavMatch(consolePath: string | null): ConsoleNavItem | null {
  const path = consolePath ?? ''
  for (const group of CONSOLE_NAV) {
    for (const item of group.items) {
      if (item.path === path) return item
    }
  }
  // Exam detail pages ride the Exams nav item.
  if (path === 'exams' || path.startsWith('exams/')) {
    return CONSOLE_NAV.flatMap((group) => group.items).find((item) => item.id === 'exams') ?? null
  }
  // ExamNote detail pages ride the Exam Notes nav item.
  if (path === 'exam-notes' || path.startsWith('exam-notes/')) {
    return CONSOLE_NAV.flatMap((group) => group.items).find((item) => item.id === 'exam-notes') ?? null
  }
  return null
}
