import React from 'react';
import { AppTheme } from '../../styles/theme';

interface PieChartProps {
    data: { [key: string]: number };
    theme: AppTheme;
    title: string;
}

const PieChart: React.FC<PieChartProps> = ({ data, theme, title }) => {
    const COLORS = ['#34D399', '#F87171', '#FBBF24', '#60A5FA', '#A78BFA', '#F472B6'];
    const total = Object.values(data).reduce((acc, value) => acc + value, 0);
    if (total === 0) {
        return (
            <div>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 500 }}>{title}</h3>
                <p style={{ color: theme.secondaryText, textAlign: 'center' }}>No data available.</p>
            </div>
        )
    }

    let accumulatedAngle = 0;
    const sortedData = Object.entries(data).sort(([, a], [, b]) => b - a);

    const paths = sortedData.map(([key, value], index) => {
        const percentage = value / total;
        const angle = percentage * 360;
        const isLargeArc = angle > 180 ? 1 : 0;

        const startX = 50 + 40 * Math.cos(Math.PI * (accumulatedAngle / 180));
        const startY = 50 + 40 * Math.sin(Math.PI * (accumulatedAngle / 180));
        accumulatedAngle += angle;
        const endX = 50 + 40 * Math.cos(Math.PI * (accumulatedAngle / 180));
        const endY = 50 + 40 * Math.sin(Math.PI * (accumulatedAngle / 180));

        const pathData = `M 50,50 L ${startX},${startY} A 40,40 0 ${isLargeArc},1 ${endX},${endY} Z`;

        return <path key={key} d={pathData} fill={COLORS[index % COLORS.length]} />;
    });

    const getLabel = (type: string) => type.replace(/_/g, ' ');

    return (
        <div>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 500 }}>{title}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <svg viewBox="0 0 100 100" width="150" height="150">
                    {paths}
                </svg>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {sortedData.map(([key, value], index) => (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', fontSize: '12px' }}>
                            <span style={{ width: 12, height: 12, backgroundColor: COLORS[index % COLORS.length], borderRadius: '50%', marginRight: 8 }}></span>
                            <span style={{ fontWeight: 500 }}>{getLabel(key)}:</span>
                            <span style={{ marginLeft: 4, color: theme.secondaryText }}>{value} ({(value / total * 100).toFixed(1)}%)</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default PieChart;
