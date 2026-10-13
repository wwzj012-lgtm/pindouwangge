import React from 'react';
import { useAuth } from '../context/AuthContext';
import { AdminConsole } from '../components/admin/AdminConsole';
import { AdminLoading } from '../components/admin/AdminPrimitives';

export default function AdminPage() {
  const { loading } = useAuth();

  if (loading) {
    return <main className="admin-root admin-entry-loading"><AdminLoading label="正在恢复登录状态…" /></main>;
  }

  return <AdminConsole />;
}
