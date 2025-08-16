import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useTheme } from '../contexts/ThemeContext'
import { lightTheme, darkTheme } from '../styles/theme'
import { MeetingSection } from '../types'

interface SectionRendererProps {
  section: MeetingSection
  onUpdateTitle: (sectionId: number, title: string) => void
  onUpdateContent: (sectionId: number, content: string) => void
  onDeleteSection: (sectionId: number) => void
  onRegenerateSection?: (sectionId: number) => void
  showControls: boolean
  onAddSectionAbove: (position: number, event?: React.MouseEvent) => void
  onAddSectionBelow: (position: number, event?: React.MouseEvent) => void
  dragHandleProps?: any
  isDragging?: boolean
  isCustomSection?: boolean
}

export default function SectionRenderer({
  section,
  onUpdateTitle,
  onUpdateContent,
  onDeleteSection,
  onRegenerateSection,
  showControls,
  onAddSectionAbove,
  onAddSectionBelow,
  dragHandleProps,
  isDragging,
  isCustomSection = false // All sections are now editable
}: SectionRendererProps) {
  const { theme } = useTheme()
  const currentTheme = theme === 'light' ? lightTheme : darkTheme
  
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [isEditingContent, setIsEditingContent] = useState(false)
  const [editedTitle, setEditedTitle] = useState(section.title)
  const [editedContent, setEditedContent] = useState(section.content || '')
  const [isHovered, setIsHovered] = useState(false)

  // Sync local state when section content changes (e.g., AI generation completes)
  React.useEffect(() => {
    setEditedTitle(section.title)
    setEditedContent(section.content || '')
  }, [section.title, section.content])

  // Auto-resize textarea when entering edit mode
  React.useEffect(() => {
    if (isEditingContent) {
      const timer = setTimeout(() => {
        const textareas = document.querySelectorAll('textarea')
        textareas.forEach(textarea => {
          textarea.style.height = 'auto'
          const newHeight = Math.max(textarea.scrollHeight, 100)
          textarea.style.height = newHeight + 'px'
        })
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [isEditingContent])

  // Separate effect to handle content changes and set initial height
  React.useEffect(() => {
    if (isEditingContent && editedContent) {
      const timer = setTimeout(() => {
        const textareas = document.querySelectorAll('textarea')
        textareas.forEach(textarea => {
          textarea.style.height = 'auto'
          const newHeight = Math.max(textarea.scrollHeight, 100)
          textarea.style.height = newHeight + 'px'
        })
      }, 10) // Small delay to ensure content is rendered
      return () => clearTimeout(timer)
    }
  }, [editedContent, isEditingContent])

  const handleTitleSave = () => {
    if (editedTitle.trim() !== section.title) {
      onUpdateTitle(section.id, editedTitle.trim())
    }
    setIsEditingTitle(false)
  }

  const handleContentSave = () => {
    if (editedContent.trim() !== (section.content || '')) {
      onUpdateContent(section.id, editedContent.trim())
    }
    setIsEditingContent(false)
  }

  const canDelete = section.section_type !== 'default_summary'

  const sectionStyle: React.CSSProperties = {
    position: 'relative',
    marginBottom: '24px',
    opacity: isDragging ? 0.5 : 1,
    transition: 'opacity 0.2s ease',
  }

  const controlsStyle: React.CSSProperties = {
    position: 'absolute',
    left: '-40px',
    top: '0',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    opacity: showControls && (isHovered || window.innerWidth <= 768) ? 1 : 0,
    transition: 'opacity 0.2s ease',
    zIndex: 10,
  }

  // Mobile detection and styles
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  
  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  
  const summaryStyle: React.CSSProperties = {
    marginLeft: isMobile ? '0' : '0',
    paddingLeft: isMobile ? '0' : '0',
    // Reduce width slightly on desktop to make room for controls
    maxWidth: !isMobile ? 'calc(100% - 20px)' : '100%',
  }

  const buttonStyle: React.CSSProperties = {
    width: '32px',
    height: '32px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    color: currentTheme.secondaryText,
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  }

  const dragHandleStyle: React.CSSProperties = {
    ...buttonStyle,
    cursor: 'grab',
    fontSize: '12px',
  }

  return (
    <div
      style={sectionStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Notion-style Controls */}
      <div style={controlsStyle}>
        {/* Add section above button */}
        <button
          onClick={(e) => onAddSectionAbove(section.position, e)}
          style={buttonStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
          title="Add section above"
        >
          +
        </button>

        {/* Drag handle (desktop only) */}
        {!isMobile && dragHandleProps && (
          <div
            {...dragHandleProps}
            style={dragHandleStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = currentTheme.background
            }}
            title="Drag to reorder"
          >
            ⋮⋮
          </div>
        )}

        {/* Delete button (if deletable) */}
        {canDelete && (
          <button
            onClick={() => onDeleteSection(section.id)}
            style={{
              ...buttonStyle,
              color: currentTheme.button.danger,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
              e.currentTarget.style.borderColor = currentTheme.button.danger
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = currentTheme.background
              e.currentTarget.style.borderColor = currentTheme.border
            }}
            title="Delete section"
          >
            ×
          </button>
        )}
      </div>

      {/* Section Content */}
      <div style={summaryStyle}>
        {/* Title */}
        {isEditingTitle ? (
          <input
            type="text"
            value={editedTitle}
            onChange={(e) => setEditedTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleSave()
              if (e.key === 'Escape') {
                setEditedTitle(section.title)
                setIsEditingTitle(false)
              }
            }}
            style={{
              fontSize: '24px',
              fontWeight: '700',
              width: '100%',
              border: 'none',
              outline: 'none',
              backgroundColor: 'transparent',
              color: currentTheme.text,
              fontFamily: "'Jost', serif",
              padding: '0',
              marginBottom: '16px',
            }}
            autoFocus
          />
        ) : (
          <h2
            onDoubleClick={() => setIsEditingTitle(true)}
            style={{
              cursor: 'text',
              fontSize: '24px',
              fontWeight: '700',
              margin: '0 0 16px 0',
              color: currentTheme.text,
              fontFamily: "'Jost', serif",
            }}
          >
            {section.title}
          </h2>
        )}

        {/* Content */}
        {section.is_generating ? (
          <div style={{ 
            color: currentTheme.secondaryText, 
            fontStyle: 'italic',
            padding: '16px 0',
            textAlign: 'center',
          }}>
            ⏳ Generating content...
          </div>
        ) : isEditingContent ? (
          <textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            onBlur={handleContentSave}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditedContent(section.content || '')
                setIsEditingContent(false)
              }
            }}
            style={{
              width: '100%',
              minHeight: '100px',
              height: Math.max(editedContent.split('\n').length * 24, 100) + 'px',
              padding: '0',
              border: 'none',
              backgroundColor: 'transparent',
              color: currentTheme.text,
              fontSize: '16px',
              lineHeight: '1.6',
              resize: 'none',
              boxSizing: 'border-box',
              fontFamily: "'Jost', serif",
              outline: 'none',
              overflow: 'hidden'
            }}
            placeholder="Enter your content here..."
            autoFocus
            onInput={(e) => {
              // Auto-resize textarea to fit content
              e.currentTarget.style.height = 'auto'
              e.currentTarget.style.height = Math.max(e.currentTarget.scrollHeight, 100) + 'px'
            }}
          />
        ) : section.content ? (
          <div
            onDoubleClick={() => setIsEditingContent(true)}
            style={{
              cursor: 'text',
              fontSize: '16px',
              lineHeight: '1.6',
              color: currentTheme.text,
              fontFamily: "'Jost', serif",
            }}
          >
            <ReactMarkdown
              children={section.content}
              components={{
                h1: ({ ...props }) => (
                  <h1 style={{ 
                    color: currentTheme.text, 
                    fontSize: '20px', 
                    fontWeight: '600', 
                    margin: '16px 0 8px 0'
                  }} {...props} />
                ),
                h2: ({ ...props }) => (
                  <h2 style={{ 
                    color: currentTheme.text, 
                    fontSize: '18px', 
                    fontWeight: '600', 
                    margin: '14px 0 6px 0'
                  }} {...props} />
                ),
                h3: ({ ...props }) => (
                  <h3 style={{ 
                    color: currentTheme.text, 
                    fontSize: '16px', 
                    fontWeight: '600', 
                    margin: '12px 0 4px 0'
                  }} {...props} />
                ),
                p: ({ ...props }) => (
                  <p style={{ 
                    lineHeight: 1.6, 
                    color: currentTheme.text, 
                    margin: '0 0 12px 0',
                    fontSize: '16px'
                  }} {...props} />
                ),
                ul: ({ ...props }) => (
                  <ul style={{ 
                    color: currentTheme.text, 
                    margin: '0 0 12px 0',
                    paddingLeft: '20px'
                  }} {...props} />
                ),
                ol: ({ ...props }) => (
                  <ol style={{ 
                    color: currentTheme.text, 
                    margin: '0 0 12px 0',
                    paddingLeft: '20px'
                  }} {...props} />
                ),
                li: ({ ...props }) => (
                  <li style={{ 
                    color: currentTheme.text, 
                    marginBottom: '4px',
                    fontSize: '16px',
                    lineHeight: 1.6
                  }} {...props} />
                ),
                strong: ({ ...props }) => (
                  <strong style={{ 
                    color: currentTheme.text, 
                    fontWeight: '600'
                  }} {...props} />
                ),
              }}
            />
          </div>
        ) : (
          <div
            onDoubleClick={() => setIsEditingContent(true)}
            style={{
              color: currentTheme.secondaryText,
              fontStyle: 'italic',
              cursor: 'text',
              padding: '16px',
              border: `1px dashed ${currentTheme.border}`,
              borderRadius: '8px',
              textAlign: 'center',
            }}
          >
            Double-click to add content...
          </div>
        )}

        {/* Mobile controls - plus, 6 dots, cross icons */}
        {isMobile && showControls && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '8px',
            marginTop: '16px',
            padding: '8px 0',
            borderTop: `1px solid ${currentTheme.border}`,
            opacity: 0.7
          }}>
            {/* Add section (plus) */}
            <button
              onClick={(e) => onAddSectionBelow(section.position + 1, e)}
              style={{
                width: '32px',
                height: '32px',
                border: 'none',
                borderRadius: '4px',
                backgroundColor: 'transparent',
                color: currentTheme.secondaryText,
                fontSize: '18px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Add section"
            >
              +
            </button>

            {/* Move section (6 dots) */}
            {dragHandleProps && (
              <div
                {...dragHandleProps}
                style={{
                  width: '32px',
                  height: '32px',
                  border: 'none',
                  borderRadius: '4px',
                  backgroundColor: 'transparent',
                  color: currentTheme.secondaryText,
                  fontSize: '18px',
                  cursor: 'grab',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Move section"
              >
                ⋮⋮
              </div>
            )}

            {/* Remove section (cross) */}
            {canDelete && (
              <button
                onClick={() => onDeleteSection(section.id)}
                style={{
                  width: '32px',
                  height: '32px',
                  border: 'none',
                  borderRadius: '4px',
                  backgroundColor: 'transparent',
                  color: currentTheme.button.danger,
                  fontSize: '18px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Remove section"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}