import React, { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { AdminPanelModal } from '../components/AdminPanelModal';

export default function AdminPage() {
  const { isAdmin, loading } = useAuth();

  useEffect(() => {
    if (!loading && !isAdmin) {
      window.location.replace('/');
    }
  }, [isAdmin, loading]);

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center">正在验证管理员权限...</div>;
  }

  if (!isAdmin) return <div className="min-h-screen bg-slate-950" />;

  return <AdminPanelModal isOpen onClose={() => window.location.replace('/')} standalone />;
}
