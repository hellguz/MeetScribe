import { AppTheme, lightTheme } from "../styles/theme";

export const getFeedbackColors = (theme: AppTheme) => {
    const light = {
        accurate: { text: '#057a55', bg: '#def7ec', border: '#10B981' },
        inaccurate: { text: '#b91c1c', bg: '#fef2f2', border: '#F87171' },
        too_short: { text: '#b45309', bg: '#fffbeb', border: '#FBBF24' },
        too_detailed: { text: '#b45309', bg: '#fffbeb', border: '#FBBF24' },
        well_structured: { text: '#057a55', bg: '#def7ec', border: '#10B981' },
        confusing: { text: '#b91c1c', bg: '#fef2f2', border: '#F87171' },
        missed_key_points: { text: '#b45309', bg: '#fffbeb', border: '#FBBF24' },
        hallucinated: { text: '#b91c1c', bg: '#fef2f2', border: '#F87171' },
        '💡 Suggestion': { text: '#1d4ed8', bg: '#eff6ff', border: '#60A5FA' },
    };
    const dark = {
        accurate: { text: '#a7f3d0', bg: '#143623', border: '#34D399' },
        inaccurate: { text: '#fecaca', bg: '#451a1a', border: '#F87171' },
        too_short: { text: '#fde68a', bg: '#422006', border: '#FBBF24' },
        too_detailed: { text: '#fde68a', bg: '#422006', border: '#FBBF24' },
        well_structured: { text: '#a7f3d0', bg: '#143623', border: '#34D399' },
        confusing: { text: '#fecaca', bg: '#451a1a', border: '#F87171' },
        missed_key_points: { text: '#fde68a', bg: '#422006', border: '#FBBF24' },
        hallucinated: { text: '#fecaca', bg: '#451a1a', border: '#F87171' },
        '💡 Suggestion': { text: '#bfdbfe', bg: '#1e3a8a', border: '#60A5FA' },
    };
    return theme.text === lightTheme.text ? light : dark;
}
