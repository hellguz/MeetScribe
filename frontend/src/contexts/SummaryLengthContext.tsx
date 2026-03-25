import React, { createContext, useState, useEffect, useMemo, useContext, ReactNode } from 'react'

export type SummaryLength = 'briefing' | 'essence' | 'narrative' | 'minutes'

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
		if (storedLength && ['briefing', 'essence', 'narrative', 'minutes'].includes(storedLength)) {
			return storedLength as SummaryLength
		}
		return 'narrative' // Default value
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
