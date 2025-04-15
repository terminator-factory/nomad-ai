// src/App.tsx
import React from 'react';
import Chat from './components/Chat';
import Header from './components/Header';
import './App.css';

const App: React.FC = () => {
  // Здесь можно добавить URL на главную страницу вашего основного проекта
  const homeUrl = 'http://allure-report-bcc-qa:8080/ui';
  
  return (
    <div className="App flex flex-col h-screen">
      <Header homeUrl={homeUrl} />
      <div className="flex-1 overflow-hidden">
        <Chat />
      </div>
    </div>
  );
};

export default App;