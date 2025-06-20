import React, { useState, useEffect, useRef } from 'react';
import { useSummaryLanguage, LanguageMode, SummaryLanguageState } from '../contexts/SummaryLanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { AppTheme, lightTheme, darkTheme } from '../styles/theme';

interface LanguageSelectorProps {
    disabled?: boolean;
    onSelectionChange: (update: Partial<SummaryLanguageState>) => void;
}

const languages = [
    "Arabic", "Chinese (Simplified)", "Czech", "Danish", "Dutch", "English",
    "Finnish", "French", "German", "Greek", "Hebrew", "Hindi",
    "Hungarian", "Indonesian", "Italian", "Japanese", "Korean", "Norwegian",
    "Polish", "Portuguese", "Romanian", "Russian", "Slovak", "Spanish",
    "Swedish", "Thai", "Turkish", "Ukrainian", "Vietnamese"
];

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ disabled = false, onSelectionChange }) => {
    const { languageState } = useSummaryLanguage();
    const { theme } = useTheme();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;

    // --- Close dropdown on outside click ---
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };

        if (isDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isDropdownOpen]);

    const handleModeClick = (mode: LanguageMode) => {
        if (disabled) return;
        setIsDropdownOpen(false);
        onSelectionChange({ mode });
    };

    const handleCustomButtonClick = () => {
        if (disabled) return;
        if (languageState.mode === 'custom') {
            setIsDropdownOpen(!isDropdownOpen);
        } else {
            onSelectionChange({ mode: 'custom' });
        }
    };
    
    const handleCustomLanguageSelect = (lang: string) => {
        if (disabled) return;
        setIsDropdownOpen(false);
        onSelectionChange({ mode: 'custom', lastCustomLanguage: lang });
    };

    const getBaseStyle = (isActive: boolean): React.CSSProperties => ({
        padding: '6px 14px',
        border: 'none',
        borderRadius: '6px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s ease',
        fontSize: '14px',
        height: '32px', // Explicit height for consistency
        boxSizing: 'border-box',
        backgroundColor: isActive ? currentThemeColors.body : 'transparent',
        color: isActive ? currentThemeColors.text : currentThemeColors.secondaryText,
        fontWeight: isActive ? 'bold' : 'normal',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        whiteSpace: 'nowrap',
    });
    
    return (
        <div
            ref={wrapperRef}
            style={{
                display: 'flex',
                position: 'relative',
                backgroundColor: currentThemeColors.backgroundSecondary,
                borderRadius: '8px',
                padding: '4px',
                width: 'fit-content',
                opacity: disabled ? 0.6 : 1,
                cursor: disabled ? 'not-allowed' : 'default',
            }}
        >
            <button
                onClick={() => handleModeClick('auto')}
                disabled={disabled}
                style={getBaseStyle(languageState.mode === 'auto')}
            >
                Auto
            </button>
            <button
                onClick={() => handleModeClick('english')}
                disabled={disabled}
                style={getBaseStyle(languageState.mode === 'english')}
            >
                English
            </button>
            <div style={{position: 'relative'}}>
                <button
                    onClick={handleCustomButtonClick}
                    disabled={disabled}
                    style={getBaseStyle(languageState.mode === 'custom')}
                >
                    {languageState.lastCustomLanguage}
                    <span style={{ marginLeft: '6px', fontSize: '10px', color: 'currentColor' }}>▼</span>
                </button>
                {isDropdownOpen && (
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '4px',
                        backgroundColor: currentThemeColors.body,
                        border: `1px solid ${currentThemeColors.border}`,
                        borderRadius: '8px',
                        zIndex: 10,
                        maxHeight: '200px',
                        overflowY: 'auto',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }}>
                        {languages.map(lang => (
                            <div
                                key={lang}
                                onClick={() => handleCustomLanguageSelect(lang)}
                                style={{
                                    padding: '8px 16px',
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    color: currentThemeColors.text,
                                    backgroundColor: languageState.lastCustomLanguage === lang ? currentThemeColors.backgroundSecondary : 'transparent'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = currentThemeColors.backgroundSecondary}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = languageState.lastCustomLanguage === lang ? currentThemeColors.backgroundSecondary : 'transparent'}
                            >
                                {lang}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default LanguageSelector;
