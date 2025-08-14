import { useState, useEffect, useCallback } from 'react'
import { MeetingSection, SectionTemplate } from '../types'

interface UseSectionsProps {
  meetingId: string | undefined
}

export const useSections = ({ meetingId }: UseSectionsProps) => {
  const [sections, setSections] = useState<MeetingSection[]>([])
  const [isLoading, setIsLoading] = useState(true) 
  const [error, setError] = useState<string | null>(null)

  const fetchSections = useCallback(async () => {
    if (!meetingId) {
      setSections([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)
      
      const response = await fetch(`/api/meetings/${meetingId}/sections`)
      if (!response.ok) {
        throw new Error(`Failed to fetch sections: ${response.statusText}`)
      }
      
      const sectionsData = await response.json()
      setSections(sectionsData)
    } catch (err) {
      console.error('Error fetching sections:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch sections')
      setSections([])
    } finally {
      setIsLoading(false)
    }
  }, [meetingId])

  const createSection = useCallback(async (template: SectionTemplate, position: number) => {
    if (!meetingId) return

    try {
      const response = await fetch(`/api/meetings/${meetingId}/sections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          meeting_id: meetingId,
          section_type: template.type,
          title: template.title,
          position
        })
      })

      if (!response.ok) {
        throw new Error(`Failed to create section: ${response.statusText}`)
      }

      const newSection = await response.json()
      
      // Insert the new section at the correct position
      setSections(current => {
        const updated = [...current]
        // Adjust positions of existing sections
        for (let i = 0; i < updated.length; i++) {
          if (updated[i].position >= position) {
            updated[i].position += 1
          }
        }
        // Add the new section
        updated.push(newSection)
        // Sort by position
        return updated.sort((a, b) => a.position - b.position)
      })

      return newSection
    } catch (err) {
      console.error('Error creating section:', err)
      setError(err instanceof Error ? err.message : 'Failed to create section')
      throw err
    }
  }, [meetingId])

  const updateSection = useCallback(async (sectionId: number, updates: Partial<MeetingSection>) => {
    try {
      const response = await fetch(`/api/sections/${sectionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      })

      if (!response.ok) {
        throw new Error(`Failed to update section: ${response.statusText}`)
      }

      const updatedSection = await response.json()
      
      setSections(current => 
        current.map(section => 
          section.id === sectionId ? updatedSection : section
        ).sort((a, b) => a.position - b.position)
      )

      return updatedSection
    } catch (err) {
      console.error('Error updating section:', err)
      setError(err instanceof Error ? err.message : 'Failed to update section')
      throw err
    }
  }, [])

  const deleteSection = useCallback(async (sectionId: number) => {
    try {
      const response = await fetch(`/api/sections/${sectionId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error(`Failed to delete section: ${response.statusText}`)
      }

      setSections(current => {
        const sectionToDelete = current.find(s => s.id === sectionId)
        if (!sectionToDelete) return current

        const updated = current.filter(s => s.id !== sectionId)
        // Adjust positions of remaining sections
        return updated.map(section => ({
          ...section,
          position: section.position > sectionToDelete.position 
            ? section.position - 1 
            : section.position
        })).sort((a, b) => a.position - b.position)
      })
    } catch (err) {
      console.error('Error deleting section:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete section')
      throw err
    }
  }, [])

  const reorderSections = useCallback(async (reorderedSections: Array<{ id: number; position: number }>) => {
    if (!meetingId) return

    try {
      const response = await fetch(`/api/meetings/${meetingId}/sections/reorder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sections: reorderedSections })
      })

      if (!response.ok) {
        throw new Error(`Failed to reorder sections: ${response.statusText}`)
      }

      // Update local state to reflect new order
      setSections(current => {
        const updated = current.map(section => {
          const reordered = reorderedSections.find(r => r.id === section.id)
          return reordered ? { ...section, position: reordered.position } : section
        })
        return updated.sort((a, b) => a.position - b.position)
      })
    } catch (err) {
      console.error('Error reordering sections:', err)
      setError(err instanceof Error ? err.message : 'Failed to reorder sections')
      throw err
    }
  }, [meetingId])

  const regenerateSection = useCallback(async (sectionId: number) => {
    try {
      const response = await fetch(`/api/sections/${sectionId}/regenerate`, {
        method: 'POST'
      })

      if (!response.ok) {
        throw new Error(`Failed to regenerate section: ${response.statusText}`)
      }

      // Mark section as generating
      setSections(current => 
        current.map(section => 
          section.id === sectionId 
            ? { ...section, is_generating: true, content: null }
            : section
        )
      )

      // Poll for completion
      const pollForContent = () => {
        setTimeout(async () => {
          try {
            const checkResponse = await fetch(`/api/meetings/${meetingId}/sections`)
            if (checkResponse.ok) {
              const updatedSections = await checkResponse.json()
              const updatedSection = updatedSections.find((s: MeetingSection) => s.id === sectionId)
              
              if (updatedSection && !updatedSection.is_generating) {
                setSections(updatedSections.sort((a: MeetingSection, b: MeetingSection) => a.position - b.position))
              } else {
                pollForContent() // Continue polling
              }
            }
          } catch (err) {
            console.error('Error polling for section content:', err)
          }
        }, 2000)
      }
      
      pollForContent()
    } catch (err) {
      console.error('Error regenerating section:', err)
      setError(err instanceof Error ? err.message : 'Failed to regenerate section')
      throw err
    }
  }, [meetingId])

  // Initial fetch
  useEffect(() => {
    fetchSections()
  }, [fetchSections])

  // Poll for generating sections
  useEffect(() => {
    const generatingSections = sections.filter(s => s.is_generating)
    
    if (generatingSections.length === 0) return

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/meetings/${meetingId}/sections`)
        if (response.ok) {
          const updatedSections = await response.json()
          setSections(updatedSections.sort((a: MeetingSection, b: MeetingSection) => a.position - b.position))
        }
      } catch (err) {
        console.error('Error polling for section updates:', err)
      }
    }, 3000)

    return () => clearInterval(pollInterval)
  }, [sections, meetingId])

  return {
    sections,
    isLoading,
    error,
    fetchSections,
    createSection,
    updateSection,
    deleteSection,
    reorderSections,
    regenerateSection
  }
}