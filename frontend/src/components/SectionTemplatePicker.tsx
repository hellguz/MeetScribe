import React, { useState, useEffect } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { lightTheme, darkTheme } from '../styles/theme'
import { SectionTemplate } from '../types'

interface SectionTemplatePickerProps {
  isOpen: boolean
  onClose: () => void
  onSelectTemplate: (template: SectionTemplate) => void
  meetingId?: string
}

const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    type: 'timeline',
    title: 'Meeting Timeline',
    icon: '📝',
    description: 'Chronological breakdown of key moments'
  },
  {
    type: 'key_points',
    title: 'Key Points',
    icon: '📊',
    description: 'Important topics as bullet points'
  },
  {
    type: 'feedback_suggestions',
    title: 'Feedback & Suggestions',
    icon: '💡',
    description: 'Meeting improvement recommendations'
  },
  {
    type: 'metrics',
    title: 'Meeting Metrics',
    icon: '📈',
    description: 'Data and statistics about the meeting'
  },
  {
    type: 'custom',
    title: 'Custom Section',
    icon: '➕',
    description: 'Create your own section with custom title'
  }
]

export default function SectionTemplatePicker({ 
  isOpen, 
  onClose, 
  onSelectTemplate,
  meetingId 
}: SectionTemplatePickerProps) {
  const { theme } = useTheme()
  const currentTheme = theme === 'light' ? lightTheme : darkTheme
  const [aiTemplates, setAiTemplates] = useState<SectionTemplate[]>([])
  const [isLoadingAiTemplates, setIsLoadingAiTemplates] = useState(false)

  useEffect(() => {
    if (isOpen && meetingId) {
      fetchAiTemplates()
    }
  }, [isOpen, meetingId])

  const fetchAiTemplates = async () => {
    if (!meetingId) return
    
    setIsLoadingAiTemplates(true)
    try {
      const response = await fetch(`/api/meetings/${meetingId}/ai-templates`, {
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

  const handleSelectTemplate = (template: SectionTemplate) => {
    onSelectTemplate(template)
    onClose()
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          backgroundColor: currentTheme.background,
          borderRadius: '8px',
          padding: '16px',
          maxWidth: '320px',
          width: '90%',
          maxHeight: '70vh',
          overflow: 'auto',
          border: `1px solid ${currentTheme.border}`,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
        }}
      >
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '12px' 
        }}>
          <h3 style={{ 
            margin: 0, 
            fontSize: '16px', 
            fontWeight: '600',
            color: currentTheme.text,
            fontFamily: "'Jost', serif"
          }}>
            Add Section
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '18px',
              cursor: 'pointer',
              color: currentTheme.secondaryText,
              padding: '2px',
              borderRadius: '4px',
              transition: 'background-color 0.2s',
              lineHeight: 1
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}
        >
          {/* Default Templates */}
          {SECTION_TEMPLATES.map((template) => (
            <button
              key={template.type}
              onClick={() => handleSelectTemplate(template)}
              style={{
                background: 'none',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 12px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
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
                fontSize: '18px', 
                lineHeight: 1,
                flexShrink: 0
              }}>
                {template.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ 
                  fontWeight: '500', 
                  fontSize: '14px', 
                  marginBottom: '2px',
                  color: currentTheme.text,
                  fontFamily: "'Jost', serif"
                }}>
                  {template.title}
                </div>
                <div style={{ 
                  fontSize: '12px', 
                  color: currentTheme.secondaryText,
                  fontFamily: "'Jost', serif"
                }}>
                  {template.description}
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
                margin: '8px 0 4px 0'
              }} />
              
              <div style={{
                fontSize: '12px',
                fontWeight: '500',
                color: currentTheme.secondaryText,
                margin: '4px 12px 8px 12px',
                fontFamily: "'Jost', serif"
              }}>
                🤖 AI Suggestions for this meeting
              </div>

              {isLoadingAiTemplates ? (
                <div style={{
                  padding: '16px 12px',
                  textAlign: 'center',
                  color: currentTheme.secondaryText,
                  fontSize: '12px',
                  fontFamily: "'Jost', serif"
                }}>
                  Generating suggestions...
                </div>
              ) : (
                aiTemplates.map((template) => (
                  <button
                    key={template.type}
                    onClick={() => handleSelectTemplate(template)}
                    style={{
                      background: 'none',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '10px 12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
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
                      fontSize: '18px', 
                      lineHeight: 1,
                      flexShrink: 0
                    }}>
                      {template.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ 
                        fontWeight: '500', 
                        fontSize: '14px', 
                        marginBottom: '2px',
                        color: currentTheme.text,
                        fontFamily: "'Jost', serif"
                      }}>
                        {template.title}
                      </div>
                      <div style={{ 
                        fontSize: '12px', 
                        color: currentTheme.secondaryText,
                        fontFamily: "'Jost', serif"
                      }}>
                        {template.description}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}