import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Удалите или закомментируйте импорт reportWebVitals
// import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Удалите или закомментируйте вызов reportWebVitals
// reportWebVitals();