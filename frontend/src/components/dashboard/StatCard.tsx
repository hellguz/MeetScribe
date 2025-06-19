import React from 'react';

interface StatCardProps {
    title: string;
    value: number | string;
    icon: string;
    color: { bg: string; border: string; text: string };
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color }) => (
    <div
        style={{
            backgroundColor: color.bg,
            padding: '20px',
            borderRadius: '12px',
            border: `1px solid ${color.border}`,
            display: 'flex',
            flexDirection: 'column',
        }}
    >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', color: color.text }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 500 }}>{title}</h3>
            <span style={{ fontSize: '24px', opacity: 0.8 }}>{icon}</span>
        </div>
        <p style={{ margin: '8px 0 0 0', fontSize: '36px', fontWeight: 'bold', color: color.text }}>
            {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
    </div>
);

export default StatCard;

