import React, { useState, useEffect } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { lightTheme, darkTheme } from '../styles/theme'
import { SectionTemplate } from '../types'

interface SectionTemplatePickerProps {
  isOpen: boolean
  onClose: () => void
  onSelectTemplate: (template: SectionTemplate) => void
  meetingId?: string
  position?: {x: number, y: number} | null
}

// Organized section templates by category for better UX
const ESSENTIAL_TEMPLATES: SectionTemplate[] = [
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
]

const ANALYSIS_TEMPLATES: SectionTemplate[] = [
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
]

const CONTEXT_TEMPLATES: SectionTemplate[] = [
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
]

const SECTION_TEMPLATES: SectionTemplate[] = [
  ...ESSENTIAL_TEMPLATES,
  ...ANALYSIS_TEMPLATES,
  ...CONTEXT_TEMPLATES
]

export default function SectionTemplatePicker({ 
  isOpen, 
  onClose, 
  onSelectTemplate,
  meetingId,
  position 
}: SectionTemplatePickerProps) {
  const { theme } = useTheme()
  const currentTheme = theme === 'light' ? lightTheme : darkTheme
  const [aiTemplates, setAiTemplates] = useState<SectionTemplate[]>([])
  const [isLoadingAiTemplates, setIsLoadingAiTemplates] = useState(false)
  const [customSectionTitle, setCustomSectionTitle] = useState('')
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (isOpen && meetingId) {
      fetchAiTemplates()
      setCustomSectionTitle('') // Clear input when opening
    }
  }, [isOpen, meetingId])

  const fetchAiTemplates = async () => {
    if (!meetingId) return
    
    setIsLoadingAiTemplates(true)
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId}/ai-templates`, {
        method: 'POST'
      })
      if (response.ok) {
        const data = await response.json()
        setAiTemplates(data.templates || [])
      }
    } catch (error) {
      console.error('Failed to fetch AI templates:', error)
    } finally {
      setIsLoadingAiTemplates(false)
    }
  }

  if (!isOpen) return null

  const allTemplates = [...SECTION_TEMPLATES, ...aiTemplates]

  const handleSelectTemplate = (template: SectionTemplate, event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }
    onSelectTemplate(template)
    onClose()
  }

  const handleCustomSectionCreate = (event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }
    if (customSectionTitle.trim()) {
      const customTemplate: SectionTemplate = {
        type: 'custom',
        title: customSectionTitle.trim(),
        icon: '✏️',
        description: 'Custom section'
      }
      handleSelectTemplate(customTemplate)
    }
  }

  const handleCustomInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCustomSectionCreate()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    // For Notion-style popup, close on any outside click
    onClose()
  }

  return (
    <>
      {/* Invisible backdrop for outside clicks */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 999,
        }}
        onClick={handleBackdropClick}
      />
      
      {/* Notion-style popup */}
      <div
        style={{
          position: 'fixed',
          top: isMobile || !position ? '50%' : position.y,
          left: isMobile || !position ? '50%' : position.x,
          transform: isMobile || !position ? 'translate(-50%, -50%)' : 'none',
          backgroundColor: currentTheme.background,
          borderRadius: '8px',
          padding: '8px 0',
          width: '280px',
          maxHeight: '400px',
          overflow: 'auto',
          border: `1px solid ${currentTheme.border}`,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
          zIndex: 1000,
        }}
      >
        <div style={{ 
          padding: '12px 16px 8px 16px',
          borderBottom: `1px solid ${currentTheme.border}`
        }}>
          <h3 style={{ 
            margin: 0, 
            fontSize: '14px', 
            fontWeight: '600',
            color: currentTheme.text,
            fontFamily: 'inherit'
          }}>
            Add Section
          </h3>
        </div>

        <div
          style={{
            padding: '4px 0'
          }}
        >
          {/* Custom Section Input - First Item */}
          <div style={{
            padding: '8px 16px',
            borderBottom: `1px solid ${currentTheme.border}`,
            marginBottom: '4px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                fontSize: '16px',
                flexShrink: 0
              }}>
                ✏️
              </div>
              <input
                type="text"
                value={customSectionTitle}
                onChange={(e) => setCustomSectionTitle(e.target.value)}
                onKeyDown={handleCustomInputKeyDown}
                placeholder="Custom section name..."
                autoFocus
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: currentTheme.text,
                  fontFamily: 'inherit',
                  padding: '4px 0'
                }}
              />
              {customSectionTitle.trim() && (
                <button
                  type="button"
                  onClick={(e) => handleCustomSectionCreate(e)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: currentTheme.button.primary,
                    fontSize: '12px',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontFamily: 'inherit'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  Create
                </button>
              )}
            </div>
          </div>

          {/* Essential Templates */}
          <div style={{
            fontSize: '12px',
            fontWeight: '500',
            color: currentTheme.secondaryText,
            padding: '8px 16px 4px 16px',
            fontFamily: 'inherit'
          }}>
            📋 Essentials
          </div>
          {ESSENTIAL_TEMPLATES.map((template) => (
            <button
              key={template.type}
              type="button"
              onClick={(e) => handleSelectTemplate(template, e)}
              style={{
                background: 'none',
                border: 'none',
                padding: '8px 16px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background-color 0.1s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                width: '100%',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              <div style={{ 
                fontSize: '16px', 
                lineHeight: 1,
                flexShrink: 0
              }}>
                {template.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ 
                  fontWeight: '500', 
                  fontSize: '14px',
                  color: currentTheme.text,
                  fontFamily: 'inherit'
                }}>
                  {template.title}
                </div>
              </div>
            </button>
          ))}

          {/* Analysis Templates */}
          <div style={{
            height: '1px',
            backgroundColor: currentTheme.border,
            margin: '4px 0'
          }} />
          <div style={{
            fontSize: '12px',
            fontWeight: '500',
            color: currentTheme.secondaryText,
            padding: '8px 16px 4px 16px',
            fontFamily: 'inherit'
          }}>
            🔍 Analysis
          </div>
          {ANALYSIS_TEMPLATES.map((template) => (
            <button
              key={template.type}
              type="button"
              onClick={(e) => handleSelectTemplate(template, e)}
              style={{
                background: 'none',
                border: 'none',
                padding: '8px 16px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background-color 0.1s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                width: '100%',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              <div style={{ 
                fontSize: '16px', 
                lineHeight: 1,
                flexShrink: 0
              }}>
                {template.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ 
                  fontWeight: '500', 
                  fontSize: '14px',
                  color: currentTheme.text,
                  fontFamily: 'inherit'
                }}>
                  {template.title}
                </div>
              </div>
            </button>
          ))}

          {/* Context Templates */}
          <div style={{
            height: '1px',
            backgroundColor: currentTheme.border,
            margin: '4px 0'
          }} />
          <div style={{
            fontSize: '12px',
            fontWeight: '500',
            color: currentTheme.secondaryText,
            padding: '8px 16px 4px 16px',
            fontFamily: 'inherit'
          }}>
            📋 Context
          </div>
          {CONTEXT_TEMPLATES.map((template) => (
            <button
              key={template.type}
              type="button"
              onClick={(e) => handleSelectTemplate(template, e)}
              style={{
                background: 'none',
                border: 'none',
                padding: '8px 16px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background-color 0.1s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                width: '100%',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              <div style={{ 
                fontSize: '16px', 
                lineHeight: 1,
                flexShrink: 0
              }}>
                {template.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ 
                  fontWeight: '500', 
                  fontSize: '14px',
                  color: currentTheme.text,
                  fontFamily: 'inherit'
                }}>
                  {template.title}
                </div>
              </div>
            </button>
          ))}

          {/* AI Templates Section */}
          {(aiTemplates.length > 0 || isLoadingAiTemplates) && (
            <>
              <div style={{
                height: '1px',
                backgroundColor: currentTheme.border,
                margin: '4px 0'
              }} />
              
              <div style={{
                fontSize: '12px',
                fontWeight: '500',
                color: currentTheme.secondaryText,
                padding: '8px 16px 4px 16px',
                fontFamily: 'inherit'
              }}>
                🤖 AI Suggestions
              </div>

              {isLoadingAiTemplates ? (
                <div style={{
                  padding: '8px 16px',
                  color: currentTheme.secondaryText,
                  fontSize: '13px',
                  fontFamily: 'inherit'
                }}>
                  Generating...
                </div>
              ) : (
                aiTemplates.map((template) => (
                  <button
                    key={template.type}
                    type="button"
                    onClick={(e) => handleSelectTemplate(template, e)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '8px 16px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background-color 0.1s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      width: '100%',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    <div style={{ 
                      fontSize: '16px', 
                      lineHeight: 1,
                      flexShrink: 0
                    }}>
                      {template.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ 
                        fontWeight: '500', 
                        fontSize: '14px',
                        color: currentTheme.text,
                        fontFamily: 'inherit'
                      }}>
                        {template.title}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
