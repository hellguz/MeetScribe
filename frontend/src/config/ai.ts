// AI Configuration
export const AI_CONFIG = {
  models: {
    templateGeneration: 'gpt-5-mini-2025-08-07',
    sectionContent: 'gpt-5-mini-2025-08-07',
    translation: 'gpt-5-mini-2025-08-07'
  },
  limits: {
    maxTemplates: 6,
    minTemplates: 4,
    transcriptPreviewLength: 1000,
    summaryPreviewLength: 1500
  }
} as const;

export const AI_PROMPTS = {
  templateGeneration: `Analyze this meeting content and suggest 4-6 highly relevant section templates.

MEETING DETAILS:
Title: {{title}}
Context: {{context}}
Duration: {{duration}} minutes
Summary: {{summary}}
Transcript preview: {{transcript}}

AVOID these existing default templates:
- Executive Summary, Action Items, Decisions Made, Questions & Concerns, Next Steps
- Meeting Flow, Who Spoke, Technical Details, Risks & Challenges, Feedback & Suggestions
- Resources & Budget, Alternatives Discussed

ANALYZE FOR:
1. Meeting type (presentation, brainstorm, review, planning, update, etc.)
2. Key content themes and specific topics discussed
3. Stakeholder needs (who would read this summary?)
4. Missing information gaps or perspectives
5. Specialized insights unique to this discussion

GENERATE 4-6 SPECIFIC templates that would genuinely help someone understand or act on this meeting.

OUTPUT FORMAT (one per line):
emoji|Title (2-4 words)|Description (specific to THIS meeting's content and value)

EXAMPLES:
🎨|Design Mockups|Visual concepts and interface designs discussed for the new app
🏗️|Architecture Decisions|Technical infrastructure choices and system design rationale
🎯|User Stories|Specific user scenarios and requirements identified during research
📊|Market Analysis|Competitive research findings and market opportunity assessment
🔬|Research Findings|Experimental results, data insights, and scientific observations
🎓|Learning Outcomes|Key knowledge gained, skills developed, and educational insights
⚖️|Legal Considerations|Compliance requirements, contracts, and regulatory constraints
🌍|Stakeholder Impact|How different groups will be affected by proposed changes

Focus on what would be MOST useful for the people involved in or affected by this meeting.`,

  fallbackTemplates: {
    discussion: [
      { title: "Key Topics", icon: "💭", description: "Main themes and subjects covered in this {{duration}}-minute discussion" },
      { title: "Outcomes", icon: "🎯", description: "What was accomplished, decided, or resolved during the meeting" },
      { title: "Open Items", icon: "🔄", description: "Unresolved questions, pending decisions, and items requiring follow-up" },
      { title: "Context & Background", icon: "📖", description: "Important background information and situational context discussed" }
    ],
    presentation: [
      { title: "Key Outcomes", icon: "🎯", description: "Main results and conclusions from this presentation" },
      { title: "Action Items", icon: "✅", description: "Tasks, deadlines, and responsibilities assigned" },
      { title: "Questions Raised", icon: "❓", description: "Open questions and items needing clarification" },
      { title: "Next Steps", icon: "➡️", description: "Planned follow-up activities and upcoming milestones" }
    ],
    review: [
      { title: "Key Outcomes", icon: "🎯", description: "Main results and conclusions from this review" },
      { title: "Action Items", icon: "✅", description: "Tasks, deadlines, and responsibilities assigned" },
      { title: "Questions Raised", icon: "❓", description: "Open questions and items needing clarification" },
      { title: "Next Steps", icon: "➡️", description: "Planned follow-up activities and upcoming milestones" }
    ]
  }
} as const;