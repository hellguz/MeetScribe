import React, { useMemo } from 'react';
import { AppTheme } from '../../styles/theme';
import { getFeedbackColors } from '../../utils/feedbackColors';

interface PieChartProps {
    data: { [key: string]: number };
    theme: AppTheme;
    title: string;
}

const PieChart: React.FC<PieChartProps> = ({ data, theme, title }) => {
    const feedbackColors = useMemo(() => getFeedbackColors(theme), [theme]);

    const total = Object.values(data).reduce((acc, value) => acc + value, 0);
    if (total === 0) {
        return (
            <div>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 500 }}>{title}</h3>
                <p style={{ color: theme.secondaryText, textAlign: 'center', padding: '20px 0' }}>No feedback data available.</p>
            </div>
        )
    }

    let accumulatedAngle = -90; // Start from the top
    const sortedData = Object.entries(data).sort(([, a], [, b]) => b - a);

    const paths = sortedData.map(([key, value]) => {
        const percentage = value / total;
        const angle = percentage * 360;
        const isLargeArc = angle > 180 ? 1 : 0;

        const startX = 50 + 45 * Math.cos(Math.PI * (accumulatedAngle / 180));
        const startY = 50 + 45 * Math.sin(Math.PI * (accumulatedAngle / 180));
        accumulatedAngle += angle;
        const endX = 50 + 45 * Math.cos(Math.PI * (accumulatedAngle / 180));
        const endY = 50 + 45 * Math.sin(Math.PI * (accumulatedAngle / 180));

        const pathData = `M 50,50 L ${startX},${startY} A 45,45 0 ${isLargeArc},1 ${endX},${endY} Z`;
        const color = (feedbackColors as any)[key]?.border || theme.secondaryText;

        return <path key={key} d={pathData} fill={color} stroke={theme.body} strokeWidth="2" />;
    });

    const getLabel = (type: string) => type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    return (
        <div>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 500 }}>{title}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'center', gap: '24px', minHeight: '150px' }}>
                <svg viewBox="0 0 100 100" width="150" height="150" style={{ flexShrink: 0, margin: '0 auto' }}>
                    {paths}
                </svg>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignSelf: 'center' }}>
                    {sortedData.map(([key, value]) => {
                        const color = (feedbackColors as any)[key]?.border || theme.secondaryText;
                        return (
                            <div key={key} style={{ display: 'flex', alignItems: 'center', fontSize: '12px' }}>
                                <span style={{ width: 12, height: 12, backgroundColor: color, borderRadius: '4px', marginRight: 8, flexShrink: 0 }}></span>
                                <span style={{ fontWeight: 500, color: theme.text }}>{getLabel(key)}:</span>
                                <span style={{ marginLeft: 'auto', paddingLeft: '10px', color: theme.secondaryText, fontWeight: 'bold' }}>{value}</span>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    );
};

export default PieChart;