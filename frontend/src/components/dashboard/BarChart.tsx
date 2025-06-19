import React from 'react';
import { AppTheme } from '../../styles/theme';

interface BarChartProps {
    data: { [key: string]: number };
    title: string;
    theme: AppTheme;
}

const BarChart: React.FC<BarChartProps> = ({ data, title, theme }) => {
    const maxValue = Math.max(...Object.values(data));

    if (maxValue === 0) {
        return (
            <div>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 500 }}>{title}</h3>
                <p style={{ color: theme.secondaryText, textAlign: 'center' }}>No device data available.</p>
            </div>
        );
    }

    return (
        <div>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 500 }}>{title}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {Object.entries(data).map(([key, value]) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ width: '80px', fontSize: '12px', color: theme.secondaryText, textAlign: 'right', flexShrink: 0 }}>{key}</span>
                        <div style={{ flexGrow: 1, backgroundColor: theme.backgroundSecondary, borderRadius: '4px' }}>
                            <div
                                style={{
                                    width: `${(value / maxValue) * 100}%`,
                                    backgroundColor: theme.button.primary,
                                    height: '20px',
                                    borderRadius: '4px',
                                    transition: 'width 0.5s ease-out',
                                }}
                            ></div>
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 'bold' }}>{value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default BarChart;

