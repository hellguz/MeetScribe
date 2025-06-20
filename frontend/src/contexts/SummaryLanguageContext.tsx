import React, { createContext, useState, useEffect, useMemo, useContext, ReactNode } from 'react';

export type LanguageMode = 'auto' | 'english' | 'custom';

// This state is now designed to always preserve the last custom language choice
export interface SummaryLanguageState {
    mode: LanguageMode;
    lastCustomLanguage: string;
}

interface SummaryLanguageContextType {
    languageState: SummaryLanguageState;
    // Allow partial updates for easier state management in components
    setLanguageState: (update: Partial<SummaryLanguageState>) => void;
}

export const SummaryLanguageContext = createContext<SummaryLanguageContextType | undefined>(undefined);

interface SummaryLanguageProviderProps {
    children: ReactNode;
}

const defaultLanguage = 'Arabic'; // Default custom language if none is stored

export const SummaryLanguageProvider: React.FC<SummaryLanguageProviderProps> = ({ children }) => {
    const [languageState, setLanguageStateInternal] = useState<SummaryLanguageState>(() => {
        try {
            const storedState = localStorage.getItem('summary_language_state_v2');
            if (storedState) {
                const parsed = JSON.parse(storedState) as SummaryLanguageState;
                // Basic validation
                if (parsed.mode && parsed.lastCustomLanguage) {
                    return parsed;
                }
            }
        } catch (error) {
            console.warn('Failed to parse summary language state from localStorage', error);
        }
        // Return a clean default state if anything fails
        return { mode: 'auto', lastCustomLanguage: defaultLanguage };
    });

    useEffect(() => {
        // Persist the entire state to localStorage on any change
        localStorage.setItem('summary_language_state_v2', JSON.stringify(languageState));
    }, [languageState]);
    
    // Wrapper to allow partial updates, making it easier for components to use.
    // e.g., setLanguageState({ mode: 'auto' }) without needing to know lastCustomLanguage
    const setLanguageState = (update: Partial<SummaryLanguageState>) => {
        setLanguageStateInternal(prevState => ({ ...prevState, ...update }));
    };

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
