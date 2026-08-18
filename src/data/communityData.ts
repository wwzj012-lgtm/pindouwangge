export interface CommunityPattern {
  id: string;
  title: string;
  description: string;
  author: {
    name: string;
    avatar: string;
  };
  category: string;
  tags: string[];
  imageUrl: string;
  width: number;
  height: number;
  boardCount: number;
  beadCount: number;
  colorCount: number;
  likes: number;
  forks: number;
  views: number;
  isLiked?: boolean;
  isFeatured?: boolean;
  sampleKey?: string;
}
