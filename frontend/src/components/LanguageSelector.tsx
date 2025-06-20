import React from 'react';
import { useSummaryLanguage, LanguageMode, SummaryLanguageState } from '../contexts/SummaryLanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { AppTheme, lightTheme, darkTheme } from '../styles/theme';

interface LanguageSelectorProps {
    disabled?: boolean;
    onSelectionChange: (newState: SummaryLanguageState) => void;
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
    const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;

    const handleModeChange = (mode: LanguageMode) => {
        if (disabled) return;
        const newState = { ...languageState, mode };
        setLanguageState(newState);
        onSelectionChange(newState);
    };

    const handleCustomLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (disabled) return;
        const newState = { mode: 'custom', customLanguage: e.target.value };
        setLanguageState(newState);
        onSelectionChange(newState);
    };

    const baseStyle: React.CSSProperties = {
        padding: '6px 14px',
        border: 'none',
        borderRadius: '6px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 'normal',
        transition: 'all 0.2s ease',
        fontSize: '14px',
        backgroundColor: 'transparent',
        color: currentThemeColors.secondaryText,
    };

    const activeStyle: React.CSSProperties = {
        ...baseStyle,
        backgroundColor: currentThemeColors.body,
        color: currentThemeColors.text,
        fontWeight: 'bold',
    };

    return (
        <div
            style={{
                display: 'flex',
                backgroundColor: currentThemeColors.backgroundSecondary,
                borderRadius: '8px',
                padding: '4px',
                width: 'fit-content',
                opacity: disabled ? 0.6 : 1,
                cursor: disabled ? 'not-allowed' : 'default',
                alignItems: 'center',
            }}
        >
            <button
                onClick={() => handleModeChange('auto')}
                disabled={disabled}
                style={languageState.mode === 'auto' ? activeStyle : baseStyle}
            >
                Auto
            </button>
            <button
                onClick={() => handleModeChange('english')}
                disabled={disabled}
                style={languageState.mode === 'english' ? activeStyle : baseStyle}
            >
                English
            </button>
            <div style={{ display: 'flex', alignItems: 'center', ...(languageState.mode === 'custom' ? activeStyle : {}) }}>
                <button
                    onClick={() => handleModeChange('custom')}
                    disabled={disabled}
                    style={{ ...baseStyle, ...(languageState.mode === 'custom' ? { color: currentThemeColors.text, fontWeight: 'bold' } : {})}}
                >
                    Custom
                </button>
                {languageState.mode === 'custom' && (
                    <select
                        value={languageState.customLanguage || ''}
                        onChange={handleCustomLanguageChange}
                        disabled={disabled}
                        style={{
                            backgroundColor: 'transparent',
                            border: 'none',
                            color: currentThemeColors.text,
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            marginLeft: '-8px', // Overlap slightly with the button text
                            paddingRight: '8px',
                        }}
                    >
                        {languages.map(lang => (
                            <option key={lang} value={lang} style={{ backgroundColor: currentThemeColors.body, color: currentThemeColors.text }}>{lang}</option>
                        ))}
                    </select>
                )}
            </div>
        </div>
    );
};

export default LanguageSelector;