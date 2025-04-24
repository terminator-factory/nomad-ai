// src/components/ModelSelector.tsx
import React, { useState } from 'react';

interface ModelOption {
  id: string;
  name: string;
  description?: string;
}

interface ModelSelectorProps {
  models: ModelOption[];
  selectedModel: string;
  onModelSelect: (modelId: string) => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  selectedModel,
  onModelSelect
}) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Получаем данные выбранной модели
  const selectedModelData = models.find(model => model.id === selectedModel);
  
  return (
    <div className="relative">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 border border-gray-700 rounded-md bg-input-bg text-white text-sm"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{selectedModelData?.name || 'Выбрать модель'}</span>
        <svg
          className="h-5 w-5 text-gray-400"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full rounded-md bg-gray-800 shadow-lg">
          <ul className="max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
            {models.map(model => (
              <li
                key={model.id}
                className={`cursor-pointer select-none relative py-2 pl-3 pr-9 text-white hover:bg-gray-700 ${
                  model.id === selectedModel ? 'bg-gray-700' : ''
                }`}
                onClick={() => {
                  onModelSelect(model.id);
                  setIsOpen(false);
                }}
              >
                <div className="flex flex-col">
                  <span className="font-medium">{model.name}</span>
                  {model.description && (
                    <span className="text-xs text-gray-400">{model.description}</span>
                  )}
                </div>
                
                {model.id === selectedModel && (
                  <span className="absolute inset-y-0 right-0 flex items-center pr-4">
                    <svg
                      className="h-5 w-5 text-green-500"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ModelSelector;