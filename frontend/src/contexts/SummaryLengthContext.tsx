import React, { createContext, useState, useEffect, useMemo, useContext, ReactNode } from 'react'

export type SummaryLength = 'auto' | 'quar_page' | 'half_page' | 'one_page' | 'two_pages'

interface SummaryLengthContextType {
	summaryLength: SummaryLength
	setSummaryLength: (length: SummaryLength) => void
}

export const SummaryLengthContext = createContext<SummaryLengthContextType | undefined>(undefined)

interface SummaryLengthProviderProps {
	children: ReactNode
}

export const SummaryLengthProvider: React.FC<SummaryLengthProviderProps> = ({ children }) => {
	const [summaryLength, setSummaryLength] = useState<SummaryLength>(() => {
		const storedLength = localStorage.getItem('summary_length')
		if (storedLength && ['auto', 'quar_page', 'half_page', 'one_page', 'two_pages'].includes(storedLength)) {
			return storedLength as SummaryLength
		}
		return 'auto' // Default value
	})

	useEffect(() => {
		localStorage.setItem('summary_length', summaryLength)
	}, [summaryLength])

	const contextValue = useMemo(() => ({ summaryLength, setSummaryLength }), [summaryLength])

	return <SummaryLengthContext.Provider value={contextValue}>{children}</SummaryLengthContext.Provider>
}

export const useSummaryLength = (): SummaryLengthContextType => {
	const context = useContext(SummaryLengthContext)
	if (context === undefined) {
		throw new Error('useSummaryLength must be used within a SummaryLengthProvider')
	}
	return context
}
