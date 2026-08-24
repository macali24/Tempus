import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthBoundary } from './components/AuthBoundary';
import './styles/foundry.css';
import './styles/auth.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthBoundary><App /></AuthBoundary>
  </React.StrictMode>,
);
