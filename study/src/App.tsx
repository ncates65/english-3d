import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Dashboard } from './components/Dashboard';

export const App: React.FC = () => {
  return (
    <BrowserRouter basename="/study">
      <Routes>
        <Route path="/" element={<Dashboard initialView="dashboard" />} />
        <Route path="/about" element={<Dashboard initialView="about" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;

