// src/components/Header.tsx
import React from 'react';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';

interface HeaderProps {
  homeUrl?: string;
}

const Header: React.FC<HeaderProps> = ({ homeUrl = '/' }) => {
  return (
    <div className="bg-brand-green border-b border-green-700 py-3 px-4"> {/* Изменен класс */}
      <div className="container mx-auto flex items-center justify-between">
        {/* Левая часть - кнопка возврата */}
        <div className="w-1/3 flex justify-start">
          <a 
            href={homeUrl} 
            className="flex items-center text-white hover:text-gray-200 transition-colors" /* Обновлен цвет текста */
          >
            <ArrowLeftIcon className="h-4 w-4 mr-1" />
            <span>Вернуться на главную</span>
          </a>
        </div>
        
        {/* Центральная часть - название */}
        <div className="w-1/3 flex justify-center">
          <h1 className="text-2xl font-bold text-white">NoMadAI</h1>
        </div>
        
        {/* Правая часть - пустая для симметрии */}
        <div className="w-1/3 flex justify-end">
          {/* Здесь можно добавить другие элементы при необходимости */}
        </div>
      </div>
    </div>
  );
};

export default Header;