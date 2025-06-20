import React, { useState } from 'react';
import { useSummaryLanguage, LanguageMode, SummaryLanguageState } from '../contexts/SummaryLanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { AppTheme, lightTheme, darkTheme } from '../styles/theme';

interface LanguageSelectorProps {
    disabled?: boolean;
    onSelectionChange: (update: Partial<SummaryLanguageState>) => void;
}

// A list of common languages for the dropdown
const languages = [
    "Arabic", "Chinese (Simplified)", "Czech", "Danish", "Dutch", "English",
    "Finnish", "French", "German", "Greek", "Hebrew", "Hindi",
    "Hungarian", "Indonesian", "Italian", "Japanese", "Korean", "Norwegian",
    "Polish", "Portuguese", "Romanian", "Russian", "Slovak", "Spanish",
    "Swedish", "Thai", "Turkish", "Ukrainian", "Vietnamese"
];

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ disabled = false, onSelectionChange }) => {
    const { languageState, setLanguageState } = useSummaryLanguage();
    const { theme } = useTheme();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;

    const handleModeClick = (mode: LanguageMode) => {
        if (disabled) return;
        setIsDropdownOpen(false); // Close dropdown on mode change
        onSelectionChange({ mode });
    };

    const handleCustomButtonClick = () => {
        if (disabled) return;
        if (languageState.mode === 'custom') {
            setIsDropdownOpen(!isDropdownOpen); // Toggle dropdown if already in custom mode
        } else {
            onSelectionChange({ mode: 'custom' }); // Switch to custom mode
        }
    };
    
    const handleCustomLanguageSelect = (lang: string) => {
        if (disabled) return;
        setIsDropdownOpen(false);
        // This is a full state update, handled by the parent
        onSelectionChange({ mode: 'custom', lastCustomLanguage: lang });
    };

    const getBaseStyle = (isActive: boolean): React.CSSProperties => ({
        padding: '6px 14px',
        border: 'none',
        borderRadius: '6px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s ease',
        fontSize: '14px',
        lineHeight: '20px', // Ensure consistent height
        height: '32px', // Explicit height
        boxSizing: 'border-box',
        backgroundColor: isActive ? currentThemeColors.body : 'transparent',
        color: isActive ? currentThemeColors.text : currentThemeColors.secondaryText,
        fontWeight: isActive ? 'bold' : 'normal',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    });
    
    return (
        <div
            style={{
                display: 'flex',
                position: 'relative', // For dropdown positioning
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
                    <span style={{ marginLeft: '6px', fontSize: '10px' }}>▼</span>
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
