import { AppTheme, lightTheme } from "../styles/theme";

export const getFeedbackColors = (theme: AppTheme) => {
    const light = {
        // Greens
        accurate: { text: '#047857', bg: '#def7ec', border: '#10B981' }, // emerald-700, emerald-100, emerald-500
        well_structured: { text: '#065f46', bg: '#d1fae5', border: '#34D399' }, // emerald-800, emerald-200, emerald-400
        
        // Ambers
        too_short: { text: '#b45309', bg: '#fffbeb', border: '#FBBF24' }, // amber-700, amber-50, amber-400
        too_detailed: { text: '#92400e', bg: '#fef3c7', border: '#F59E0B' }, // amber-800, amber-200, amber-500
        missed_key_points: { text: '#78350f', bg: '#fde68a', border: '#D97706' }, // amber-900, amber-300, amber-600

        // Reds
        inaccurate: { text: '#b91c1c', bg: '#fee2e2', border: '#F87171' }, // red-700, red-100, red-400
        confusing: { text: '#991b1b', bg: '#fecaca', border: '#EF4444' }, // red-800, red-200, red-500
        hallucinated: { text: '#7f1d1d', bg: '#fca5a5', border: '#DC2626' }, // red-900, red-300, red-600

        '💡 Suggestion': { text: '#1d4ed8', bg: '#eff6ff', border: '#60A5FA' },
    };
    const dark = {
        // Greens
        accurate: { text: '#6ee7b7', bg: '#064e3b', border: '#10B981' }, // emerald-300, emerald-900, emerald-500
        well_structured: { text: '#a7f3d0', bg: '#143623', border: '#34D399' }, // emerald-200, custom, emerald-400
        
        // Ambers
        too_short: { text: '#fcd34d', bg: '#451a03', border: '#FBBF24' }, // amber-300, amber-950, amber-400
        too_detailed: { text: '#fde68a', bg: '#422006', border: '#F59E0B' }, // amber-200, custom, amber-500
        missed_key_points: { text: '#fef08a', bg: '#532e08', border: '#D97706' }, // amber-200/300, custom, amber-600

        // Reds
        inaccurate: { text: '#fca5a5', bg: '#450a0a', border: '#F87171' }, // red-300, red-950, red-400
        confusing: { text: '#fecaca', bg: '#511313', border: '#EF4444' }, // red-200, custom, red-500
        hallucinated: { text: '#fda4af', bg: '#601414', border: '#DC2626' }, // rose-300, custom, red-600

        '💡 Suggestion': { text: '#bfdbfe', bg: '#1e3a8a', border: '#60A5FA' },
    };
    return theme.text === lightTheme.text ? light : dark;
}
