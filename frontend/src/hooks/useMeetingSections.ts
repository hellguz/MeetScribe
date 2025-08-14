import { useState, useEffect, useCallback } from 'react'
import { SectionTemplate } from '../config/sectionTemplates'

export interface MeetingSection {
  id: number
  meeting_id: string
  section_type: 'default' | 'custom'
  section_key: string
  title: string
  content?: string
  position: number
  is_enabled: boolean
  template_type?: string
  created_at: string
  updated_at: string
}

export const useMeetingSections = (meetingId: string | undefined) => {
  const [sections, setSections] = useState<MeetingSection[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSections = useCallback(async () => {
    if (!meetingId) return
    
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId}/sections`)
      if (!response.ok) {
        throw new Error('Failed to fetch sections')
      }
      const sectionsData = await response.json()
      setSections(sectionsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error('Error fetching sections:', err)
    } finally {
      setIsLoading(false)
    }
  }, [meetingId])

  const createSection = useCallback(async (template: SectionTemplate | null, customTitle?: string, position: number = 0) => {
    if (!meetingId) return

    try {
      const sectionData = {
        section_key: template?.key || 'custom',
        title: template?.title || customTitle || 'Custom Section',
        template_type: template?.key || 'custom',
        position: position
      }

      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId}/sections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sectionData),
      })

      if (!response.ok) {
        throw new Error('Failed to create section')
      }

      const newSection = await response.json()
      setSections(prev => [...prev, newSection].sort((a, b) => a.position - b.position))

      // If it's a template section, trigger AI generation
      if (template) {
        generateSectionContent(newSection.id)
      }

      return newSection
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error('Error creating section:', err)
    }
  }, [meetingId])

  const updateSection = useCallback(async (sectionId: number, updates: { title?: string; content?: string; is_enabled?: boolean }) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/sections/${sectionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        throw new Error('Failed to update section')
      }

      const updatedSection = await response.json()
      setSections(prev => prev.map(section => 
        section.id === sectionId ? updatedSection : section
      ))

      return updatedSection
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error('Error updating section:', err)
    }
  }, [])

  const deleteSection = useCallback(async (sectionId: number) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/sections/${sectionId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete section')
      }

      setSections(prev => prev.filter(section => section.id !== sectionId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error('Error deleting section:', err)
    }
  }, [])

  const reorderSections = useCallback(async (sectionIds: number[]) => {
    if (!meetingId) return

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId}/sections/reorder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ section_ids: sectionIds }),
      })

      if (!response.ok) {
        throw new Error('Failed to reorder sections')
      }

      // Update local state to reflect new positions
      setSections(prev => {
        const sectionMap = new Map(prev.map(s => [s.id, s]))
        return sectionIds.map((id, index) => {
          const section = sectionMap.get(id)
          return section ? { ...section, position: index } : null
        }).filter(Boolean) as MeetingSection[]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error('Error reordering sections:', err)
    }
  }, [meetingId])

  const generateSectionContent = useCallback(async (sectionId: number) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/sections/${sectionId}/generate`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to generate section content')
      }

      // The generation will happen in the background
      // We could poll for updates or use WebSocket for real-time updates
      return await response.json()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error('Error generating section content:', err)
    }
  }, [])

  const initializeDefaultSections = useCallback(async (summary: string) => {
    if (!meetingId || sections.length > 0) return

    // Parse the existing summary into sections
    const lines = summary.split('\n')
    const parsedSections: Array<{ key: string; title: string; content: string; position: number }> = []
    
    let currentSection: { key: string; title: string; content: string; position: number } | null = null
    let position = 0

    for (const line of lines) {
      if (line.startsWith('#### ')) {
        if (currentSection) {
          parsedSections.push(currentSection)
          position++
        }
        const title = line.replace('#### ', '').trim()
        const key = title.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '')
        currentSection = { key, title: line, content: '', position }
      } else if (line.startsWith('### ')) {
        if (currentSection) {
          parsedSections.push(currentSection)
          position++
        }
        const title = line.replace('### ', '').trim()
        const key = title.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '')
        currentSection = { key, title: line, content: '', position }
      } else if (currentSection) {
        currentSection.content += line + '\n'
      }
    }

    if (currentSection) {
      parsedSections.push(currentSection)
    }

    // Create default sections in the database
    try {
      const promises = parsedSections.map(async (section) => {
        const sectionData = {
          section_key: section.key,
          title: section.title,
          template_type: 'custom', // Set a valid template_type
          position: section.position
        }

        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId}/sections`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(sectionData),
        })

        if (response.ok) {
          const newSection = await response.json()
          // Update with the existing content from the parsed summary
          if (section.content.trim()) {
            await updateSection(newSection.id, { content: section.content.trim() })
          }
          return newSection
        }
        return null
      })

      const createdSections = await Promise.all(promises)
      const validSections = createdSections.filter(Boolean) as MeetingSection[]
      setSections(validSections)
    } catch (err) {
      console.error('Error initializing default sections:', err)
    }
  }, [meetingId, sections.length, updateSection])

  useEffect(() => {
    fetchSections()
  }, [fetchSections])

  return {
    sections,
    isLoading,
    error,
    createSection,
    updateSection,
    deleteSection,
    reorderSections,
    generateSectionContent,
    initializeDefaultSections,
    refetch: fetchSections,
  }
}