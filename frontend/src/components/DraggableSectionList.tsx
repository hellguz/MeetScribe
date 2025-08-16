import React from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd'
import { MeetingSection } from '../types'
import SectionRenderer from './SectionRenderer'

interface DraggableSectionListProps {
  sections: MeetingSection[]
  onReorder: (reorderedSections: Array<{ id: number; position: number }>) => void
  onUpdateTitle: (sectionId: number, title: string) => void
  onUpdateContent: (sectionId: number, content: string) => void
  onDeleteSection: (sectionId: number) => void
  onRegenerateSection: (sectionId: number) => void
  onAddSectionAbove: (position: number, event?: React.MouseEvent) => void
  onAddSectionBelow: (position: number, event?: React.MouseEvent) => void
  showControls: boolean
  enableDragAndDrop?: boolean
}

export default function DraggableSectionList({
  sections,
  onReorder,
  onUpdateTitle,
  onUpdateContent,
  onDeleteSection,
  onRegenerateSection,
  onAddSectionAbove,
  onAddSectionBelow,
  showControls,
  enableDragAndDrop = true
}: DraggableSectionListProps) {
  const [isMobile, setIsMobile] = React.useState(window.innerWidth <= 768)
  
  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || !enableDragAndDrop) return

    const { source, destination } = result
    
    if (source.index === destination.index) return

    // Create a new array with reordered sections
    const reorderedSections = Array.from(sections)
    const [removed] = reorderedSections.splice(source.index, 1)
    reorderedSections.splice(destination.index, 0, removed)

    // Map to the format expected by the API
    const reorderData = reorderedSections.map((section, index) => ({
      id: section.id,
      position: index
    }))

    onReorder(reorderData)
  }

  // If drag-and-drop is disabled (mobile) or not enabled, render sections normally
  if (!enableDragAndDrop || isMobile) {
    return (
      <div>
        {sections.map((section) => (
          <SectionRenderer
            key={section.id}
            section={section}
            onUpdateTitle={onUpdateTitle}
            onUpdateContent={onUpdateContent}
            onDeleteSection={onDeleteSection}
            onRegenerateSection={onRegenerateSection}
            showControls={showControls}
            onAddSectionAbove={onAddSectionAbove}
            onAddSectionBelow={onAddSectionBelow}
            isCustomSection={section.section_type === 'custom'}
          />
        ))}
      </div>
    )
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId="sections">
        {(provided, snapshot) => (
          <div
            {...provided.droppableProps}
            ref={provided.innerRef}
            style={{
              minHeight: '100px',
              transition: 'background-color 0.2s ease',
              backgroundColor: snapshot.isDraggingOver ? 'rgba(0, 0, 0, 0.02)' : 'transparent',
            }}
          >
            {sections.map((section, index) => (
              <Draggable
                key={section.id.toString()}
                draggableId={section.id.toString()}
                index={index}
                isDragDisabled={!showControls}
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    style={{
                      ...provided.draggableProps.style,
                      marginBottom: '0', // Remove margin to prevent layout issues
                    }}
                  >
                    <SectionRenderer
                      section={section}
                      onUpdateTitle={onUpdateTitle}
                      onUpdateContent={onUpdateContent}
                      onDeleteSection={onDeleteSection}
                      onRegenerateSection={onRegenerateSection}
                      showControls={showControls}
                      onAddSectionAbove={onAddSectionAbove}
                      onAddSectionBelow={onAddSectionBelow}
                      dragHandleProps={provided.dragHandleProps}
                      isDragging={snapshot.isDragging}
                      isCustomSection={section.section_type === 'custom'}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  )
}