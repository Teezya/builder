import React from 'react';
import { Navigate } from 'react-router-dom';

export default function Billing() {
  return <Navigate to="/profile?tab=billing" replace />;
}
