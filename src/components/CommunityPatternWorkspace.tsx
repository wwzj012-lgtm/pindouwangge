import React from 'react';
import { useAuth } from '../context/AuthContext';
import type { StoredPatternProject } from '../utils/patternGridCodec';
import { PracticeWorkspace } from './PracticeWorkspace';
import './CommunityPatternWorkspace.css';

interface CommunityPatternWorkspaceProps {
  project: StoredPatternProject;
  postId: string;
  title: string;
  initialMode?: 'practice' | 'crop';
  onClose: () => void;
  onEdit: (project: StoredPatternProject) => boolean | void;
  onUpgrade: () => void;
  onOpenInventory: () => void;
}

/**
 * Community entry point. The workspace itself lives in {@link PracticeWorkspace} so the
 * board, the library and the community all share one practice surface — this wrapper only
 * pins the community-specific bits (post id progress key, region copy, export).
 */
export function CommunityPatternWorkspace({ project, postId, title, initialMode = 'practice', onClose, onEdit, onUpgrade, onOpenInventory }: CommunityPatternWorkspaceProps) {
  // The timer is scoped per account; passing it through keeps existing timers intact.
  const { currentUser } = useAuth();
  return <PracticeWorkspace
    project={project}
    title={title}
    source="community"
    workKey={'community:' + postId}
    postId={postId}
    userId={currentUser?.uid ?? null}
    initialMode={initialMode}
    onClose={onClose}
    onEdit={onEdit}
    onUpgrade={onUpgrade}
    onOpenInventory={onOpenInventory}
  />;
}
