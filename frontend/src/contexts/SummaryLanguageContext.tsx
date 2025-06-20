import React, { createContext, useState, useEffect, useMemo, useContext, ReactNode } from 'react';

export type LanguageMode = 'auto' | 'english' | 'custom';

export interface SummaryLanguageState {
    mode: LanguageMode;
    customLanguage: string | null;
}

interface SummaryLanguageContextType {
    languageState: SummaryLanguageState;
    setLanguageState: (state: SummaryLanguageState) => void;
}

export const SummaryLanguageContext = createContext<SummaryLanguageContextType | undefined>(undefined);

interface SummaryLanguageProviderProps {
    children: ReactNode;
}

const defaultLanguage = 'English'; // Default for custom dropdown

export const SummaryLanguageProvider: React.FC<SummaryLanguageProviderProps> = ({ children }) => {
    const [languageState, setLanguageState] = useState<SummaryLanguageState>(() => {
        try {
            const storedState = localStorage.getItem('summary_language_state');
            if (storedState) {
                const parsed = JSON.parse(storedState) as SummaryLanguageState;
                // Ensure custom language is set if mode is custom
                if (parsed.mode === 'custom' && !parsed.customLanguage) {
                    parsed.customLanguage = defaultLanguage;
                }
                return parsed;
            }
        } catch (error) {
            console.warn('Failed to parse summary language state from localStorage', error);
        }
        return { mode: 'auto', customLanguage: null }; // Default state
    });

    useEffect(() => {
        // Ensure state consistency
        const correctedState = { ...languageState };
        if (languageState.mode !== 'custom') {
            correctedState.customLanguage = null;
        } else if (languageState.mode === 'custom' && !languageState.customLanguage) {
            correctedState.customLanguage = defaultLanguage;
        }

        localStorage.setItem('summary_language_state', JSON.stringify(correctedState));
    }, [languageState]);

    const contextValue = useMemo(() => ({ languageState, setLanguageState }), [languageState]);

    return (
        <SummaryLanguageContext.Provider value={contextValue}>
            {children}
        </SummaryLanguageContext.Provider>
    );
};

export const useSummaryLanguage = (): SummaryLanguageContextType => {
    const context = useContext(SummaryLanguageContext);
    if (context === undefined) {
        throw new Error('useSummaryLanguage must be used within a SummaryLanguageProvider');
    }
    return context;
};
