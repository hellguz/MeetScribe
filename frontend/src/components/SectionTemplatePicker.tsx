import React, { useState } from 'react'
import { SECTION_TEMPLATES, SectionTemplate } from '../config/sectionTemplates'
import { useTheme } from '../contexts/ThemeContext'
import { lightTheme, darkTheme } from '../styles/theme'

interface SectionTemplatePickerProps {
  isVisible: boolean
  onClose: () => void
  onSelectTemplate: (template: SectionTemplate) => void
  onSelectCustom: () => void
}

export default function SectionTemplatePicker({
  isVisible,
  onClose,
  onSelectTemplate,
  onSelectCustom
}: SectionTemplatePickerProps) {
  const { theme } = useTheme()
  const currentTheme = theme === 'light' ? lightTheme : darkTheme
  const [customTitle, setCustomTitle] = useState('')

  if (!isVisible) return null

  const handleCustomSubmit = () => {
    if (customTitle.trim()) {
      onSelectCustom()
      setCustomTitle('')
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
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: currentTheme.background,
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '500px',
          width: '90%',
          maxHeight: '80vh',
          overflowY: 'auto',
          border: `1px solid ${currentTheme.border}`,
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            margin: '0 0 20px 0',
            fontSize: '1.2em',
            fontWeight: '600',
            color: currentTheme.text,
            textAlign: 'center',
          }}
        >
          Add Section
        </h3>

        {/* Template Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          {SECTION_TEMPLATES.map((template) => (
            <button
              key={template.key}
              onClick={() => {
                onSelectTemplate(template)
                onClose()
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '16px',
                border: `1px solid ${currentTheme.border}`,
                borderRadius: '12px',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                textAlign: 'center',
                color: currentTheme.text,
                fontFamily: "'Jost', serif",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <div style={{ fontSize: '2em', marginBottom: '8px' }}>
                {template.icon}
              </div>
              <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                {template.title}
              </div>
              <div
                style={{
                  fontSize: '0.85em',
                  color: currentTheme.secondaryText,
                  lineHeight: '1.3',
                }}
              >
                {template.description}
              </div>
            </button>
          ))}
        </div>

        {/* Custom Section Input */}
        <div
          style={{
            borderTop: `1px solid ${currentTheme.border}`,
            paddingTop: '20px',
          }}
        >
          <label
            htmlFor="custom-section-title"
            style={{
              display: 'block',
              fontWeight: '600',
              marginBottom: '8px',
              fontSize: '0.9em',
              color: currentTheme.text,
            }}
          >
            Or create a custom section:
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              id="custom-section-title"
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Enter section title..."
              style={{
                flex: 1,
                padding: '10px 12px',
                border: `1px solid ${currentTheme.input.border}`,
                borderRadius: '8px',
                backgroundColor: currentTheme.input.background,
                color: currentTheme.input.text,
                fontSize: '14px',
                fontFamily: "'Jost', serif",
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCustomSubmit()
                }
              }}
            />
            <button
              onClick={handleCustomSubmit}
              disabled={!customTitle.trim()}
              style={{
                padding: '10px 16px',
                border: 'none',
                borderRadius: '8px',
                backgroundColor: customTitle.trim()
                  ? currentTheme.button.primary
                  : currentTheme.border,
                color: customTitle.trim()
                  ? currentTheme.button.primaryText
                  : currentTheme.secondaryText,
                fontSize: '14px',
                fontWeight: '500',
                cursor: customTitle.trim() ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s ease',
                fontFamily: "'Jost', serif",
              }}
            >
              Add
            </button>
          </div>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            width: '32px',
            height: '32px',
            border: 'none',
            borderRadius: '50%',
            backgroundColor: 'transparent',
            color: currentTheme.secondaryText,
            cursor: 'pointer',
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}