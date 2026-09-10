/**
 * Human-readable byte counts, for download sizes and model weights.
 *
 * Lived in OnDevicePanel until that panel was folded into the Local mode
 * switch; three unrelated components were importing a formatter from a UI
 * component, which is why it moved rather than followed the panel.
 */
export const formatBytes = (bytes: number): string =>
	bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.round(bytes / 1e3)} kB`
