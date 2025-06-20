import React from 'react';

interface StatCardProps {
    title: string;
    value: number | string;
    icon: string;
    color: {
        bg: string;
        border: string;
        text: string;
    };
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color }) => {

    const formatHours = (val: number): string => {
        if (isNaN(val)) return "00:00";
        const totalMinutes = Math.round(val * 60);
        const hh = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
        const mm = (totalMinutes % 60).toString().padStart(2, '0');
        return `${hh}:${mm}`;
    };

    let displayValue = value;
    if (title.toLowerCase().includes('hours') && typeof value === 'number') {
        // Convert from seconds to hours before formatting
        const hours = value / 3600;
        displayValue = formatHours(hours);
    } else if (typeof value === 'number') {
        displayValue = value.toLocaleString();
    }


    return (
        <div style={{ backgroundColor: color.bg, border: `1px solid ${color.border}`, borderRadius: '12px', padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ fontSize: '24px', backgroundColor: 'rgba(255,255,255,0.1)', padding: '12px', borderRadius: '8px' }}>
                {icon}
            </div>
            <div>
                <p style={{ margin: 0, color: color.text, fontSize: '14px', fontWeight: '500' }}>{title}</p>
                <p style={{ margin: '4px 0 0', color: color.text, fontSize: '28px', fontWeight: 'bold' }}>
                    {displayValue}
                </p>
            </div>
        </div>
    );
};

export default StatCard;
