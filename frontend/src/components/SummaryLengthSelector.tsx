import React, { useEffect, useState, useRef } from 'react';
import { SummaryLength } from '../contexts/SummaryLengthContext';
import { useTheme } from '../contexts/ThemeContext';
import { AppTheme, lightTheme, darkTheme } from '../styles/theme';

interface SummaryLengthSelectorProps {
	value: SummaryLength;
	disabled?: boolean;
	onSelect: (preset: SummaryLength) => void;
}

const options: { label: string; value: SummaryLength }[] = [
	{ label: 'Auto', value: 'auto' },
	{ label: '¼ Page', value: 'quar_page' },
	{ label: '½ Page', value: 'half_page' },
	{ label: '1 Page', value: 'one_page' },
	{ label: '2 Pages', value: 'two_pages' },
];

const SummaryLengthSelector: React.FC<SummaryLengthSelectorProps> = ({ value, disabled = false, onSelect }) => {
	const { theme } = useTheme();
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

	const handleSelect = (length: SummaryLength) => {
		if (disabled) return;
        setIsDropdownOpen(false);
		onSelect(length);
	};

    if (isMobile) {
        const currentLabel = options.find(opt => opt.value === value)?.label;
        return (
            <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
                <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    disabled={disabled}
                    style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: `1px solid ${currentThemeColors.border}`,
                        fontSize: '14px',
                        backgroundColor: currentThemeColors.body,
                        color: currentThemeColors.text,
                        opacity: disabled ? 0.6 : 1,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        textAlign: 'left',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                        cursor: 'pointer'
                    }}
                >
                    <span>{`Length: ${currentLabel}`}</span>
                    <span style={{ transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
                </button>
                {isDropdownOpen && (
                    <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px',
                        backgroundColor: currentThemeColors.body, border: `1px solid ${currentThemeColors.border}`,
                        borderRadius: '8px', zIndex: 10,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }}>
                        {options.map(option => (
                            <div
                                key={option.value}
                                onClick={() => handleSelect(option.value)}
                                style={{
                                    padding: '10px 12px',
                                    cursor: 'pointer',
                                    fontWeight: value === option.value ? 'bold' : 'normal',
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = currentThemeColors.backgroundSecondary}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                                {option.label}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

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
			}}>
			{options.map((option) => {
				const isActive = value === option.value;
				return (
					<button
						key={option.value}
						onClick={() => handleSelect(option.value)}
						disabled={disabled}
						style={{
							padding: '6px 14px',
							border: 'none',
							borderRadius: '6px',
							backgroundColor: isActive ? currentThemeColors.body : 'transparent',
							color: isActive ? currentThemeColors.text : currentThemeColors.secondaryText,
							cursor: disabled ? 'not-allowed' : 'pointer',
							fontWeight: isActive ? 'bold' : 'normal',
							transition: 'all 0.2s ease',
							fontSize: '14px',
							height: '32px',
							boxSizing: 'border-box',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							whiteSpace: 'nowrap',
						}}>
						{option.label}
					</button>
				);
			})}
		</div>
	);
};

export default SummaryLengthSelector;
