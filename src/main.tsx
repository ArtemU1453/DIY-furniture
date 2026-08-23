import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { bootstrapEngines } from './engines';
import './styles.css';

// Регистрируем движки по умолчанию до старта UI.
bootstrapEngines();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
