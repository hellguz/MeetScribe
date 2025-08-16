import { SectionTemplate } from '../types';

export const ESSENTIAL_TEMPLATES: SectionTemplate[] = [
  {
    type: 'executive_summary',
    title: 'Executive Summary',
    icon: '📋',
    description: 'High-level overview for stakeholders and decision-makers'
  },
  {
    type: 'action_items',
    title: 'Action Items',
    icon: '✅',
    description: 'Tasks, deadlines, and assigned responsibilities'
  },
  {
    type: 'decisions_made',
    title: 'Decisions Made',
    icon: '🎯',
    description: 'Key decisions reached and their reasoning'
  },
  {
    type: 'next_steps',
    title: 'Next Steps',
    icon: '➡️',
    description: 'What happens next and upcoming milestones'
  }
];

export const ANALYSIS_TEMPLATES: SectionTemplate[] = [
  {
    type: 'questions_raised',
    title: 'Questions & Concerns',
    icon: '❓',
    description: 'Open questions, concerns, and items needing clarification'
  },
  {
    type: 'risks_challenges',
    title: 'Risks & Challenges',
    icon: '⚠️',
    description: 'Potential issues, blockers, and mitigation strategies'
  },
  {
    type: 'alternatives_considered',
    title: 'Alternatives Discussed',
    icon: '🔄',
    description: 'Different approaches, options, and trade-offs considered'
  },
  {
    type: 'feedback_given',
    title: 'Feedback & Suggestions',
    icon: '💬',
    description: 'Input, suggestions, and recommendations shared'
  }
];

export const CONTEXT_TEMPLATES: SectionTemplate[] = [
  {
    type: 'timeline',
    title: 'Meeting Flow',
    icon: '⏱️',
    description: 'Chronological progression with timestamps'
  },
  {
    type: 'participants',
    title: 'Who Spoke',
    icon: '👥',
    description: 'Speaker contributions and key insights from each person'
  },
  {
    type: 'technical_details',
    title: 'Technical Details',
    icon: '🔧',
    description: 'Implementation specifics, requirements, and constraints'
  },
  {
    type: 'budget_resources',
    title: 'Resources & Budget',
    icon: '💰',
    description: 'Cost implications, resource needs, and budget discussions'
  }
];

export const SECTION_TEMPLATES: SectionTemplate[] = [
  ...ESSENTIAL_TEMPLATES,
  ...ANALYSIS_TEMPLATES,
  ...CONTEXT_TEMPLATES
];

export const TEMPLATE_CATEGORIES = {
  ESSENTIAL: {
    title: '📋 Essentials',
    templates: ESSENTIAL_TEMPLATES
  },
  ANALYSIS: {
    title: '🔍 Analysis',
    templates: ANALYSIS_TEMPLATES
  },
  CONTEXT: {
    title: '📋 Context',
    templates: CONTEXT_TEMPLATES
  }
} as const;