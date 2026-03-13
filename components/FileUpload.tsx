import React from 'react';
import { Upload, FileSpreadsheet } from 'lucide-react';

interface Props {
  onFileUpload: (files: File[]) => void;
  title?: string;
  subtitle?: string;
  accept?: string;
  allowMultiple?: boolean;
  disabled?: boolean;
}

export const FileUpload: React.FC<Props> = ({
  onFileUpload,
  title = "Drop Schedule Files Here",
  subtitle = "Supports Master Schedule (.xlsx)",
  accept = ".xlsx, .csv",
  allowMultiple = true,
  disabled = false
}) => {
  const [isDragging, setIsDragging] = React.useState(false);

  const handleDrag = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileUpload(Array.from(e.dataTransfer.files));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.target.files && e.target.files.length > 0) {
      onFileUpload(Array.from(e.target.files));
    }
  };

  return (
    <div
      className={`
        relative border-4 border-dashed rounded-3xl p-8 text-center transition-all duration-200
        ${disabled
          ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-70'
          : isDragging
            ? 'cursor-pointer border-brand-blue bg-blue-50'
            : 'cursor-pointer border-gray-200 hover:border-gray-300 bg-white'}
      `}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        type="file"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        onChange={handleChange}
        accept={accept}
        multiple={allowMultiple}
        disabled={disabled}
      />
      <div className="flex flex-col items-center justify-center space-y-4">
        <div className={`p-4 rounded-full ${disabled ? 'bg-gray-100' : isDragging ? 'bg-blue-100' : 'bg-gray-100'}`}>
          <Upload className={`w-8 h-8 ${disabled ? 'text-gray-300' : isDragging ? 'text-brand-blue' : 'text-gray-400'}`} />
        </div>
        <div>
          <h3 className="text-xl font-extrabold text-gray-700">
            {disabled ? 'Busy processing workspace' : isDragging ? 'Drop it like it\'s hot!' : title}
          </h3>
          <p className="text-gray-400 font-bold mt-2">
            {disabled ? 'Wait for the current task to finish before uploading files.' : subtitle}
          </p>
        </div>
      </div>
    </div>
  );
};
