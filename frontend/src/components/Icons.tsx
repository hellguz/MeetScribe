import React from 'react'

interface IconProps {
	size?: number
}

const iconProps = (size: number) => ({
	width: size,
	height: size,
	viewBox: '0 0 24 24',
	fill: 'none',
	stroke: 'currentColor',
	strokeWidth: 2,
	strokeLinecap: 'round' as const,
	strokeLinejoin: 'round' as const,
})

export const SunIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<circle cx="12" cy="12" r="5" />
		<line x1="12" y1="1" x2="12" y2="3" />
		<line x1="12" y1="21" x2="12" y2="23" />
		<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
		<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
		<line x1="1" y1="12" x2="3" y2="12" />
		<line x1="21" y1="12" x2="23" y2="12" />
		<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
		<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
	</svg>
)

export const MoonIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
	</svg>
)

export const CopyTextIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<rect x="9" y="9" width="13" height="13" rx="2" />
		<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
	</svg>
)

export const CopyMarkdownIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<polyline points="16 18 22 12 16 6" />
		<polyline points="8 6 2 12 8 18" />
	</svg>
)

export const EditIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
	</svg>
)

export const TrashIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<polyline points="3 6 5 6 21 6" />
		<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
		<path d="M10 11v6" />
		<path d="M14 11v6" />
		<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
	</svg>
)

export const StarIcon: React.FC<IconProps & { filled?: boolean }> = ({ size = 14, filled = false }) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill={filled ? 'currentColor' : 'none'}
		stroke="currentColor"
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round">
		<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
	</svg>
)

export const TagIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
		<line x1="7" y1="7" x2="7.01" y2="7" />
	</svg>
)

export const PlusIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<line x1="12" y1="5" x2="12" y2="19" />
		<line x1="5" y1="12" x2="19" y2="12" />
	</svg>
)

export const CheckIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<polyline points="20 6 9 17 4 12" />
	</svg>
)

export const SpeakersIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
		<circle cx="9" cy="7" r="4" />
		<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
		<path d="M16 3.13a4 4 0 0 1 0 7.75" />
	</svg>
)

export const InfoIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<circle cx="12" cy="12" r="10" />
		<line x1="12" y1="16" x2="12" y2="12" />
		<line x1="12" y1="8" x2="12.01" y2="8" />
	</svg>
)

export const CloseIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<line x1="18" y1="6" x2="6" y2="18" />
		<line x1="6" y1="6" x2="18" y2="18" />
	</svg>
)

export const ShareIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
		<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
	</svg>
)

export const LockIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
		<path d="M7 11V7a5 5 0 0 1 10 0v4" />
	</svg>
)

export const UnlockIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
		<path d="M7 11V7a5 5 0 0 1 9.9-1" />
	</svg>
)

export const CloudIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
	</svg>
)

export const DownloadIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
		<polyline points="7 10 12 15 17 10" />
		<line x1="12" y1="15" x2="12" y2="3" />
	</svg>
)

export const AlertIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
		<line x1="12" y1="9" x2="12" y2="13" />
		<line x1="12" y1="17" x2="12.01" y2="17" />
	</svg>
)
