import React, { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { useTheme } from '../contexts/ThemeContext'
import { lightTheme, darkTheme } from '../styles/theme'
import SectionTemplatePicker from './SectionTemplatePicker'
import { SECTION_TEMPLATES, SectionTemplate } from '../config/sectionTemplates'

interface Section {
  id: number
  section_key: string
  title: string
  content?: string
  position: number
  is_enabled: boolean
  section_type: 'default' | 'custom'
  template_type?: string
}

interface CustomizableSummaryProps {
  meetingId: string
  sections: Section[]
  onSectionAdd: (template: SectionTemplate | null, customTitle?: string) => void
  onSectionRemove: (sectionId: number) => void
  onSectionReorder: (sectionIds: number[]) => void
  onSectionUpdate: (sectionId: number, updates: { title?: string; content?: string; is_enabled?: boolean }) => void
  isEditable?: boolean
}

export default function CustomizableSummary({
  meetingId,
  sections,
  onSectionAdd,
  onSectionRemove,
  onSectionReorder,
  onSectionUpdate,
  isEditable = true
}: CustomizableSummaryProps) {
  const { theme } = useTheme()
  const currentTheme = theme === 'light' ? lightTheme : darkTheme
  
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [hoveredSection, setHoveredSection] = useState<number | null>(null)
  const [draggedSection, setDraggedSection] = useState<number | null>(null)

  // Sort sections by position
  const sortedSections = [...sections].sort((a, b) => a.position - b.position)

  const handleAddSection = useCallback((position: number) => {
    setShowTemplatePicker(true)
    // Store the position for when template is selected
  }, [])

  const handleTemplateSelect = useCallback((template: SectionTemplate) => {
    onSectionAdd(template)
  }, [onSectionAdd])

  const handleCustomSection = useCallback(() => {
    onSectionAdd(null, 'Custom Section')
  }, [onSectionAdd])

  const handleDragStart = (e: React.DragEvent, sectionId: number) => {
    setDraggedSection(sectionId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent, targetPosition: number) => {
    e.preventDefault()
    if (draggedSection === null) return

    const newOrder = [...sortedSections]
    const draggedIndex = newOrder.findIndex(s => s.id === draggedSection)
    const targetIndex = newOrder.findIndex(s => s.position === targetPosition)
    
    if (draggedIndex !== -1 && targetIndex !== -1) {
      const [removed] = newOrder.splice(draggedIndex, 1)
      newOrder.splice(targetIndex, 0, removed)
      
      const reorderedIds = newOrder.map(s => s.id)
      onSectionReorder(reorderedIds)
    }
    
    setDraggedSection(null)
  }

  const renderSection = (section: Section, index: number) => {
    const isHovered = hoveredSection === section.id
    const isDragged = draggedSection === section.id
    const showControls = isEditable && isHovered
    const isMobile = window.innerWidth <= 768
    
    return (
      <div key={section.id}>
        {/* Section Content */}
        <div
          style={{
            position: 'relative',
            marginBottom: '24px',
            opacity: isDragged ? 0.5 : 1,
            transition: 'opacity 0.2s ease',
            paddingLeft: isEditable ? (isMobile ? '20px' : '60px') : '0', // Space for controls on the left
          }}
          onMouseEnter={() => setHoveredSection(section.id)}
          onMouseLeave={(e) => {
            // Don't hide if moving to left controls area
            const rect = e.currentTarget.getBoundingClientRect()
            const leftBound = rect.left - (isMobile ? 30 : 70)
            if (e.clientX < leftBound) {
              // Don't hide when moving to controls area
              return
            }
            setHoveredSection(null)
          }}
          onTouchStart={() => setHoveredSection(section.id)} // Touch support
          draggable={isEditable && !isMobile} // Disable drag on mobile
          onDragStart={(e) => handleDragStart(e, section.id)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, section.position)}
        >
          {/* Left Controls Area */}
          {isEditable && (
            <div
              style={{
                position: 'absolute',
                left: isMobile ? '-20px' : '-60px',
                top: '8px',
                display: 'flex',
                flexDirection: isMobile ? 'row' : 'column',
                alignItems: 'center',
                gap: '4px',
                opacity: isMobile ? (showControls ? 1 : 0.4) : (showControls ? 1 : 0.1),
                transition: 'opacity 0.2s ease',
              }}
              onMouseEnter={() => setHoveredSection(section.id)}
              onMouseLeave={() => {
                // Add a small delay to prevent flickering
                setTimeout(() => setHoveredSection(null), 100)
              }}
            >
              {/* Add Section Button - above current section */}
              {index > 0 && (
                <button
                  onClick={() => handleAddSection(section.position)}
                  style={{
                    width: isMobile ? '24px' : '20px',
                    height: isMobile ? '24px' : '20px',
                    borderRadius: '50%',
                    border: `1px solid ${showControls ? currentTheme.button.primary : currentTheme.border}`,
                    backgroundColor: 'transparent',
                    color: showControls ? currentTheme.button.primary : currentTheme.secondaryText,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: isMobile ? '14px' : '12px',
                    fontWeight: 'bold',
                    transition: 'all 0.2s ease',
                    touchAction: 'manipulation',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
                    e.currentTarget.style.transform = 'scale(1.1)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                    e.currentTarget.style.transform = 'scale(1)'
                  }}
                >
                  +
                </button>
              )}
              
              {/* Drag Handle - only show on desktop */}
              {!isMobile && (
                <div
                  style={{
                    width: '20px',
                    height: '24px',
                    cursor: 'grab',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: showControls ? currentTheme.secondaryText : currentTheme.border,
                    fontSize: '16px',
                    transition: 'color 0.2s ease',
                  }}
                >
                  ⋮⋮
                </div>
              )}
            </div>
          )}

          {/* Section Controls */}
          {(showControls || window.innerWidth <= 768) && section.section_type === 'custom' && (
            <div
              style={{
                position: 'absolute',
                right: '0',
                top: '0',
                display: 'flex',
                gap: '8px',
                // On mobile, always show with lower opacity until touched
                opacity: window.innerWidth <= 768 ? (showControls ? 1 : 0.6) : 1,
                transition: 'opacity 0.2s ease',
              }}
            >
              <button
                onClick={() => onSectionRemove(section.id)}
                style={{
                  width: window.innerWidth <= 768 ? '32px' : '24px', // Larger on mobile
                  height: window.innerWidth <= 768 ? '32px' : '24px',
                  border: 'none',
                  borderRadius: '50%',
                  backgroundColor: currentTheme.button.danger,
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: window.innerWidth <= 768 ? '16px' : '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  touchAction: 'manipulation', // Better touch handling
                }}
              >
                ×
              </button>
            </div>
          )}

          {/* Section Title */}
          <div style={{ marginBottom: '12px' }}>
            {section.title.startsWith('####') ? (
              <h4 style={{ margin: 0, color: currentTheme.text }}>
                {section.title.replace('####', '').trim()}
              </h4>
            ) : section.title.startsWith('###') ? (
              <h3 style={{ margin: 0, color: currentTheme.text }}>
                {section.title.replace('###', '').trim()}
              </h3>
            ) : (
              <h4 style={{ margin: 0, color: currentTheme.text }}>
                {section.title}
              </h4>
            )}
          </div>

          {/* Section Content */}
          {section.content ? (
            <ReactMarkdown
              components={{
                h1: ({ ...props }) => <h1 style={{ color: currentTheme.text }} {...props} />,
                h2: ({ ...props }) => <h2 style={{ color: currentTheme.text }} {...props} />,
                h3: ({ ...props }) => <h3 style={{ color: currentTheme.text }} {...props} />,
                h4: ({ ...props }) => <h4 style={{ color: currentTheme.text }} {...props} />,
                p: ({ ...props }) => <p style={{ lineHeight: 1.6 }} {...props} />,
              }}
            >
              {section.content}
            </ReactMarkdown>
          ) : (
            <div
              style={{
                padding: '20px',
                borderRadius: '8px',
                backgroundColor: currentTheme.backgroundSecondary,
                border: `1px dashed ${currentTheme.border}`,
                textAlign: 'center',
                color: currentTheme.secondaryText,
                fontStyle: 'italic',
              }}
            >
              AI content is being generated for this section...
            </div>
          )}
        </div>
      </div>
    )
  }

  const isMobile = window.innerWidth <= 768
    
  return (
    <div style={{ position: 'relative', paddingLeft: isEditable ? (isMobile ? '20px' : '60px') : '0' }}>
      {/* Add Section at the beginning */}
      {isEditable && (
        <div
          style={{
            position: 'absolute',
            left: isMobile ? '-20px' : '-60px',
            top: '0',
            display: 'flex',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <button
            onClick={() => handleAddSection(0)}
            style={{
              width: isMobile ? '24px' : '20px',
              height: isMobile ? '24px' : '20px',
              borderRadius: '50%',
              border: `1px solid ${currentTheme.border}`,
              backgroundColor: 'transparent',
              color: currentTheme.secondaryText,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: isMobile ? '14px' : '12px',
              fontWeight: 'bold',
              transition: 'all 0.2s ease',
              opacity: 0.6,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = currentTheme.button.primary
              e.currentTarget.style.color = currentTheme.button.primary
              e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
              e.currentTarget.style.opacity = '1'
              e.currentTarget.style.transform = 'scale(1.1)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = currentTheme.border
              e.currentTarget.style.color = currentTheme.secondaryText
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.opacity = '0.6'
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            +
          </button>
        </div>
      )}

      {/* Render Sections */}
      {sortedSections.map((section, index) => renderSection(section, index))}

      {/* Add Section at the end */}
      {isEditable && (
        <div
          style={{
            position: 'relative',
            marginTop: '16px',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: isMobile ? '-20px' : '-60px',
              top: '0',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <button
              onClick={() => handleAddSection(999)}
              style={{
                width: isMobile ? '24px' : '20px',
                height: isMobile ? '24px' : '20px',
                borderRadius: '50%',
                border: `1px solid ${currentTheme.border}`,
                backgroundColor: 'transparent',
                color: currentTheme.secondaryText,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: isMobile ? '14px' : '12px',
                fontWeight: 'bold',
                transition: 'all 0.2s ease',
                opacity: 0.6,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = currentTheme.button.primary
                e.currentTarget.style.color = currentTheme.button.primary
                e.currentTarget.style.backgroundColor = currentTheme.backgroundSecondary
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.transform = 'scale(1.1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = currentTheme.border
                e.currentTarget.style.color = currentTheme.secondaryText
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.opacity = '0.6'
                e.currentTarget.style.transform = 'scale(1)'
              }}
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* Template Picker Modal */}
      <SectionTemplatePicker
        isVisible={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
        onSelectTemplate={handleTemplateSelect}
        onSelectCustom={handleCustomSection}
      />
    </div>
  )
}