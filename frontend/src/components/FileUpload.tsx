import React, { useRef, useState } from 'react';
import { AppTheme } from '../styles/theme';

interface FileUploadProps {
    selectedFile: File | null;
    onFileSelect: (file: File | null) => void;
    disabled: boolean;
    theme: AppTheme;
}

const FileUpload: React.FC<FileUploadProps> = ({ selectedFile, onFileSelect, disabled, theme }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onFileSelect(file);
        }
        e.target.value = ''; // Allow re-selecting the same file
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith('audio/')) {
            onFileSelect(file);
        } else {
            alert('Please drop a valid audio file.');
        }
    };

    return (
        <div
            onDragEnter={(e) => {
                e.preventDefault();
                setIsDragging(true);
            }}
            onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => !disabled && fileInputRef.current?.click()}
            style={{
                border: `2px dashed ${isDragging ? theme.button.primary : theme.input.border}`,
                borderRadius: '8px',
                padding: '32px',
                textAlign: 'center',
                cursor: disabled ? 'not-allowed' : 'pointer',
                backgroundColor: isDragging ? theme.backgroundSecondary : 'transparent',
                color: theme.text,
                transition: 'all 0.2s ease',
                opacity: disabled ? 0.5 : 1,
            }}>
            <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={handleFileChange}
                accept="audio/mp3,audio/wav,audio/aac,audio/ogg,audio/m4a"
                disabled={disabled}
            />
            <p style={{ margin: 0, fontWeight: 500, color: theme.text }}>
                {selectedFile ? `Selected: ${selectedFile.name}` : 'Drag & drop an audio file, or click to select'}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '14px', color: theme.secondaryText }}>
                MP3, WAV, AAC, etc. are supported
            </p>
        </div>
    );
};

export default FileUpload;

