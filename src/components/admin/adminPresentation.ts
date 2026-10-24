/** Display labels only. API values and business rules remain unchanged. */
const labels: Record<string, string> = {
  active: '正常', disabled: '已停用', archived: '已归档', deleted: '已删除',
  private: '私有', public: '公开', restricted: '受限',
  open: '待处理', reviewing: '处理中', resolved: '已处理', rejected: '已驳回',
  approve: '通过审核', hide: '隐藏', remove: '移除', restore: '恢复', feature: '推荐', unfeature: '取消推荐',
  work: '图纸作品', post: '社区帖子', comment: '评论',
  draft: '草稿', scheduled: '定时', published: '已发布', withdrawn: '已撤回',
  all: '所有用户', vip: 'VIP 会员', pro: '商家 Pro',
  admin: '管理员操作', user: '用户行为', error: '错误事件',
};

export function adminLabel(value?: string | null): string {
  if (!value) return '未提供';
  return labels[value] ?? `未知状态（${value}）`;
}

const roles: Record<string, string> = {
  super_admin: '超级管理员', operations: '运营管理员', content_moderator: '内容审核员', read_only: '只读管理员',
};
export function adminRoleLabel(code: string, name?: string): string {
  return name && /[\u3400-\u9fff]/u.test(name) ? name : roles[code] ?? `自定义角色（${code}）`;
}
export function adminPermissionLabel(code: string, name?: string): string {
  return name && /[\u3400-\u9fff]/u.test(name) ? name : `权限项（${code}）`;
}

export function adminPageCount(total: number, limit = 20): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, limit)));
}

export function adminErrorText(message: string): { summary: string; detail?: string } {
  if (/[\u3400-\u9fff]/u.test(message)) return { summary: message };
  return { summary: '操作未完成，请检查输入或稍后重试；如仍失败，请联系管理员。', detail: message };
}
