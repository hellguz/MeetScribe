import { useState, useEffect, useCallback } from 'react'
import { MeetingSection, SectionTemplate } from '../types'

interface UseSectionsProps {
  meetingId: string | undefined
  isProcessing: boolean // NEW: Get processing status from parent hook
}

export const useSections = ({ meetingId, isProcessing }: UseSectionsProps) => {
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
      // Don't set loading to true on polls, only on initial load
      if (isLoading) {
        setError(null)
      }
      
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId}/sections`)
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
  }, [meetingId, isLoading])

  // Initial fetch
  useEffect(() => {
    fetchSections()
  }, [fetchSections])

  // NEW: Polling logic based on the isProcessing flag from useMeetingSummary
  useEffect(() => {
    if (isProcessing) {
      // When processing starts, clear current sections to show the loading state
      setSections([]);
      const pollInterval = setInterval(fetchSections, 3000);
      return () => clearInterval(pollInterval);
    }
  }, [isProcessing, fetchSections]);

  const createSection = useCallback(async (template: SectionTemplate, position: number) => {
    if (!meetingId) return

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId}/sections`, {
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

      await fetchSections() // Refetch all sections to ensure correct order
    } catch (err) {
      console.error('Error creating section:', err)
      setError(err instanceof Error ? err.message : 'Failed to create section')
      throw err
    }
  }, [meetingId, fetchSections])

  const updateSection = useCallback(async (sectionId: number, updates: Partial<MeetingSection>) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/sections/${sectionId}`, {
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
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/sections/${sectionId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error(`Failed to delete section: ${response.statusText}`)
      }

      await fetchSections() // Refetch all sections to ensure correct order
    } catch (err) {
      console.error('Error deleting section:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete section')
      throw err
    }
  }, [fetchSections])

  const reorderSections = useCallback(async (reorderedSections: Array<{ id: number; position: number }>) => {
    if (!meetingId) return

    // Optimistically update the UI
    setSections(current => {
      const sectionMap = new Map(current.map(s => [s.id, s]));
      const reordered = reorderedSections.map(r => {
        const section = sectionMap.get(r.id);
        return section ? { ...section, position: r.position } : null;
      }).filter(Boolean) as MeetingSection[];
      return reordered.sort((a, b) => a.position - b.position);
    });

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId}/sections/reorder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sections: reorderedSections })
      })

      if (!response.ok) {
        throw new Error(`Failed to reorder sections: ${response.statusText}`)
      }
      
      // Data is already updated, but a refetch can ensure consistency.
      await fetchSections();

    } catch (err) {
      console.error('Error reordering sections:', err)
      setError(err instanceof Error ? err.message : 'Failed to reorder sections')
      await fetchSections(); // Revert on error
      throw err
    }
  }, [meetingId, fetchSections])

  const regenerateSection = useCallback(async (sectionId: number) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/sections/${sectionId}/regenerate`, {
        method: 'POST'
      })

      if (!response.ok) {
        throw new Error(`Failed to regenerate section: ${response.statusText}`)
      }

      await fetchSections() // Just refetch to get updated generating status

    } catch (err) {
      console.error('Error regenerating section:', err)
      setError(err instanceof Error ? err.message : 'Failed to regenerate section')
      throw err
    }
  }, [fetchSections])

  return {
    sections,
    isLoading: isLoading,
    error,
    fetchSections,
    createSection,
    updateSection,
    deleteSection,
    reorderSections,
    regenerateSection
  }
}
