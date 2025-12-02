import React from 'react';
import { Upload, FileSpreadsheet } from 'lucide-react';

interface Props {
  onFileUpload: (file: File) => void;
}

export const FileUpload: React.FC<Props> = ({ onFileUpload }) => {
  const [isDragging, setIsDragging] = React.useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileUpload(e.target.files[0]);
    }
  };

  return (
    <div 
      className={`
        relative border-4 border-dashed rounded-3xl p-8 text-center transition-all duration-200 cursor-pointer
        ${isDragging ? 'border-brand-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'}
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
        accept=".xlsx, .csv"
      />
      <div className="flex flex-col items-center justify-center space-y-4">
        <div className={`p-4 rounded-full ${isDragging ? 'bg-blue-100' : 'bg-gray-100'}`}>
          <Upload className={`w-8 h-8 ${isDragging ? 'text-brand-blue' : 'text-gray-400'}`} />
        </div>
        <div>
          <h3 className="text-xl font-extrabold text-gray-700">
            {isDragging ? 'Drop it like it\'s hot!' : 'Drop Schedule Files Here'}
          </h3>
          <p className="text-gray-400 font-bold mt-2">
            Supports Master Schedule (.xlsx) & MVT Export (.csv)
          </p>
        </div>
        <div className="flex gap-2">
            <span className="px-3 py-1 rounded-lg bg-gray-100 text-xs font-bold text-gray-500 flex items-center gap-1">
                <FileSpreadsheet size={14} /> Master.xlsx
            </span>
            <span className="px-3 py-1 rounded-lg bg-gray-100 text-xs font-bold text-gray-500 flex items-center gap-1">
                <FileSpreadsheet size={14} /> MVT.csv
            </span>
        </div>
      </div>
    </div>
  );
};