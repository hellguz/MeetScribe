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
    title: '📝 Meeting Timeline',
    icon: '📝',
    description: 'Chronological breakdown of key moments'
  },
  {
    type: 'key_points',
    title: '📊 Key Points',
    icon: '📊',
    description: 'Important topics as bullet points'
  },
  {
    type: 'feedback_suggestions',
    title: '💡 Feedback & Suggestions',
    icon: '💡',
    description: 'Meeting improvement recommendations'
  },
  {
    type: 'metrics',
    title: '📈 Meeting Metrics',
    icon: '📈',
    description: 'Data and statistics about the meeting'
  },
  {
    type: 'custom',
    title: '➕ Custom Section',
    icon: '➕',
    description: 'Create your own section with a custom title'
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

  const [suggestedTemplates, setSuggestedTemplates] = useState<SectionTemplate[]>([])
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [isAddingCustom, setIsAddingCustom] = useState(false)
  const [customSectionTitle, setCustomSectionTitle] = useState('')

  useEffect(() => {
    if (isOpen && meetingId) {
      const fetchSuggestions = async () => {
        setIsLoadingSuggestions(true)
        try {
          const response = await fetch(`/api/meetings/${meetingId}/suggest-sections`)
          if (response.ok) {
            const data = await response.json()
            setSuggestedTemplates(data)
          }
        } catch (error) {
          console.error('Error fetching suggested sections:', error)
        } finally {
          setIsLoadingSuggestions(false)
        }
      }
      fetchSuggestions()
    } else if (!isOpen) {
      // Reset state when modal is closed
      setSuggestedTemplates([])
      setIsAddingCustom(false)
      setCustomSectionTitle('')
    }
  }, [isOpen, meetingId])

  if (!isOpen) return null

  const handleSelectTemplate = (template: SectionTemplate) => {
    if (template.type === 'custom') {
      setIsAddingCustom(true)
    } else {
      onSelectTemplate(template)
      onClose()
    }
  }

  const handleAddCustomSection = () => {
    if (customSectionTitle.trim()) {
      const customTemplate: SectionTemplate = {
        type: 'custom',
        title: customSectionTitle.trim(),
        icon: '➕',
        description: 'A custom section created by you.'
      };
      onSelectTemplate(customTemplate);
      onClose();
    }
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const renderTemplateButton = (template: SectionTemplate, isSuggestion: boolean) => (
    <button
      key={template.type + (isSuggestion ? '-sugg' : '')}
      onClick={() => handleSelectTemplate(template)}
      style={{
        background: 'none',
        border: `1px solid ${currentTheme.border}`,
        borderRadius: '12px',
        padding: '16px',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.2s ease',
        backgroundColor: currentTheme.backgroundSecondary,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = currentTheme.button.primary
        e.currentTarget.style.backgroundColor = currentTheme.background
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = currentTheme.border
        e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <div style={{ fontSize: '28px', marginBottom: '8px', lineHeight: 1 }}>
        {template.icon}
      </div>
      <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '4px', color: currentTheme.text, fontFamily: "'Jost', serif" }}>
        {template.title.replace(/^[📝📊💡📈➕]\s/, '')}
      </div>
      <div style={{ fontSize: '12px', color: currentTheme.secondaryText, lineHeight: 1.4, fontFamily: "'Jost', serif" }}>
        {template.description}
      </div>
    </button>
  )

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '500px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
          border: `1px solid ${currentTheme.border}`,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: currentTheme.text, fontFamily: "'Jost', serif" }}>
            Add Section
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: currentTheme.secondaryText, padding: '4px', borderRadius: '4px', transition: 'background-color 0.2s' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
          >
            ✕
          </button>
        </div>

        {isAddingCustom ? (
          <div>
            <h3 style={{ marginTop: 0, fontSize: '16px', fontWeight: '600', color: currentTheme.text, fontFamily: "'Jost', serif" }}>
              Add Custom Section
            </h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={customSectionTitle}
                onChange={(e) => setCustomSectionTitle(e.target.value)}
                placeholder="Enter section title..."
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustomSection() }}
                style={{
                  flexGrow: 1,
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: `1px solid ${currentTheme.input.border}`,
                  backgroundColor: currentTheme.input.background,
                  color: currentTheme.input.text,
                  fontSize: '14px',
                }}
              />
              <button
                onClick={handleAddCustomSection}
                disabled={!customSectionTitle.trim()}
                style={{
                  padding: '10px 16px',
                  border: 'none',
                  borderRadius: '8px',
                  backgroundColor: currentTheme.button.primary,
                  color: currentTheme.button.primaryText,
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: customSectionTitle.trim() ? 'pointer' : 'not-allowed',
                  opacity: customSectionTitle.trim() ? 1 : 0.6,
                }}
              >
                Add
              </button>
            </div>
          </div>
        ) : (
          <>
            {isLoadingSuggestions && <p>Loading suggestions...</p>}

            {suggestedTemplates.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ marginTop: 0, fontSize: '16px', fontWeight: '600', color: currentTheme.text, fontFamily: "'Jost', serif" }}>
                  AI Suggestions
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  {suggestedTemplates.map(template => renderTemplateButton(template, true))}
                </div>
              </div>
            )}

            <div>
              <h3 style={{ marginTop: 0, fontSize: '16px', fontWeight: '600', color: currentTheme.text, fontFamily: "'Jost', serif" }}>
                All Templates
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                {SECTION_TEMPLATES.map(template => renderTemplateButton(template, false))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}