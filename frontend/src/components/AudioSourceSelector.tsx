import React from 'react';
import { AppTheme } from '../styles/theme';
import { AudioSource } from '../types';

interface AudioSourceSelectorProps {
    audioSource: AudioSource;
    setAudioSource: (source: AudioSource) => void;
    includeMic: boolean;
    setIncludeMic: (include: boolean) => void;
    isSystemAudioSupported: boolean;
    disabled: boolean;
    theme: AppTheme;
}

const AudioSourceSelector: React.FC<AudioSourceSelectorProps> = ({
    audioSource,
    setAudioSource,
    includeMic,
    setIncludeMic,
    isSystemAudioSupported,
    disabled,
    theme,
}) => {
    return (
        <div style={{ marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '20px', opacity: disabled ? 0.5 : 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label htmlFor="audio-source-select" style={{ fontWeight: 500, color: theme.text }}>
                        Audio Source:
                    </label>
                    <select
                        id="audio-source-select"
                        value={audioSource}
                        onChange={(e) => setAudioSource(e.target.value as AudioSource)}
                        disabled={disabled}
                        style={{
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: `1px solid ${theme.input.border}`,
                            fontSize: '16px',
                            backgroundColor: theme.input.background,
                            color: theme.input.text,
                        }}>
                        <option value="mic">Microphone</option>
                        <option value="system">System Audio (Speakers)</option>
                        <option value="file">Upload Audio File</option>
                    </select>
                </div>
            </div>

            {audioSource === 'system' && !isSystemAudioSupported && (
                <div
                    style={{
                        padding: '12px',
                        backgroundColor: theme.backgroundSecondary,
                        border: `1px solid ${theme.border}`,
                        color: theme.text,
                        borderRadius: '8px',
                        textAlign: 'center',
                    }}>
                    ⚠️ System audio recording is not supported on your device or browser (e.g., iPhones/iPads). This option is unlikely to work.
                </div>
            )}
            {audioSource === 'system' && isSystemAudioSupported && (
                <div
                    style={{
                        padding: '12px',
                        backgroundColor: theme.backgroundSecondary,
                        border: `1px solid ${theme.border}`,
                        color: theme.text,
                        borderRadius: '8px',
                        textAlign: 'center',
                        fontSize: '14px',
                        lineHeight: 1.5,
                    }}>
                    ℹ️ When prompted, choose a screen, window, or tab to share. <br />
                    <b>Crucially, ensure you check the "Share system audio" or "Share tab audio" box</b> to record sound.
                </div>
            )}

            {audioSource === 'system' && (
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        padding: '10px',
                        backgroundColor: theme.backgroundSecondary,
                        borderRadius: '8px',
                    }}>
                    <input
                        type="checkbox"
                        id="include-mic-checkbox"
                        checked={includeMic}
                        onChange={(e) => setIncludeMic(e.target.checked)}
                        disabled={disabled}
                        style={{ marginRight: '8px', width: '16px', height: '16px' }}
                    />
                    <label htmlFor="include-mic-checkbox" style={{ fontWeight: 500, color: theme.text, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                        Include microphone audio
                    </label>
                </div>
            )}
        </div>
    );
};

export default AudioSourceSelector;

