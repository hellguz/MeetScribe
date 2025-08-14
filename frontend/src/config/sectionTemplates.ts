export interface SectionTemplate {
  key: string
  title: string
  description: string
  icon: string
  prompt: string  // AI generation prompt for this section type
}

export const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    key: 'timeline',
    title: 'Meeting Timeline',
    description: 'Chronological breakdown of key moments',
    icon: '⏰',
    prompt: `Create a chronological timeline of the key moments and topics discussed in this meeting. Focus on when different topics were introduced, major decisions made, and transitions between discussion points. Format as a clear timeline with timestamps or sequence indicators.`
  },
  {
    key: 'bullet_points',
    title: 'Key Points',
    description: 'Important topics and takeaways as bullet points',
    icon: '📝',
    prompt: `Extract the most important topics, insights, and takeaways from this meeting into a clear bullet point format. Focus on actionable insights, key information shared, and important points that attendees should remember.`
  },
  {
    key: 'feedback',
    title: 'Feedback & Suggestions',
    description: 'Improvement suggestions and constructive feedback',
    icon: '💡',
    prompt: `Analyze this meeting to provide constructive feedback on how it could have been run more effectively. Include suggestions for better preparation, facilitation, follow-up, and overall meeting structure. Focus on actionable improvements.`
  },
  {
    key: 'metrics',
    title: 'Meeting Metrics',
    description: 'Data and statistics about the meeting',
    icon: '📊',
    prompt: `Provide quantitative insights and metrics about this meeting, such as: participation levels, time spent on different topics, frequency of interruptions, decision velocity, and overall meeting effectiveness. Include any measurable observations.`
  }
]

export const getTemplateByKey = (key: string): SectionTemplate | undefined => {
  return SECTION_TEMPLATES.find(template => template.key === key)
}

export const getDefaultSections = (): Array<{key: string, title: string, position: number}> => {
  return [
    { key: 'summary', title: 'Summary', position: 0 },
    { key: 'key_decisions', title: 'Key Decisions & Action Items', position: 999 }  // Always last
  ]
}