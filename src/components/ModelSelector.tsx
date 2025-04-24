// src/components/ModelSelector.tsx
import React, { useState, useRef, useEffect } from 'react';

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
  const [openUpward, setOpenUpward] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Получаем данные выбранной модели
  const selectedModelData = models.find(model => model.id === selectedModel);
  
  // Функция для определения направления открытия выпадающего списка
  useEffect(() => {
    if (isOpen && buttonRef.current && dropdownRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const dropdownHeight = dropdownRef.current.offsetHeight;
      
      // Если внизу недостаточно места, открываем вверх
      const spaceBelow = windowHeight - buttonRect.bottom;
      const shouldOpenUpward = spaceBelow < dropdownHeight && buttonRect.top > dropdownHeight;
      
      setOpenUpward(shouldOpenUpward);
    }
  }, [isOpen]);
  
  // Закрытие списка при клике вне компонента
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isOpen && 
          buttonRef.current && 
          dropdownRef.current && 
          !buttonRef.current.contains(event.target as Node) && 
          !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);
  
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 border border-gray-700 rounded-md bg-input-bg text-white text-sm hover:border-gray-500 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{selectedModelData?.name || 'Выбрать модель'}</span>
        <svg
          className={`h-5 w-5 text-gray-400 transition-transform ${isOpen ? 'transform rotate-180' : ''}`}
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
        <div 
          ref={dropdownRef}
          className={`absolute z-20 w-full rounded-md bg-gray-800 shadow-lg ${
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
          style={{ maxHeight: '300px' }}
        >
          <ul 
            className="max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm"
            role="listbox"
          >
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
                role="option"
                aria-selected={model.id === selectedModel}
              >
                <div className="flex flex-col">
                  <span className="font-medium">{model.name}</span>
                  {model.description && (
                    <span className="text-xs text-gray-400 whitespace-normal">{model.description}</span>
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