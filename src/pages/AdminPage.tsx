import React from 'react';
import { useAuth } from '../context/AuthContext';
import { AdminConsole } from '../components/admin/AdminConsole';

export default function AdminPage() {
  const { loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center">正在验证管理员权限...</div>;
  }

  return <AdminConsole />;
}
