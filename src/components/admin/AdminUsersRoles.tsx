import React from 'react';
import type { AdminRequest } from './adminRequest';
import { AdminUsers } from './AdminUsers';
import { AdminRoles } from './AdminRoles';

export function AdminUsersRoles({ mode, request }: { mode: 'users' | 'roles'; request: AdminRequest }) {
  return <div className="admin-users-roles">{mode === 'users' ? <AdminUsers request={request} /> : <AdminRoles request={request} />}</div>;
}
