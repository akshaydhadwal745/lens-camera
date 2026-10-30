// Blog posts, English + Hindi (growth workspace: drafted by the growth agent as pull requests, reviewed
// and merged by a person). Same rules as the guides: written for the reader's problem, every claim about
// Lens true (docs/growth/product-facts.md), claims about other products general, dated and checkable.
// The blog (/blog/ and /blog/<slug>/) appears only once there is at least one post.
import type { Lang } from '../i18n/ui';
import type { PageCopy } from './pages';

export type BlogPost = {
  /** URL part: /blog/<slug>/ */
  slug: string;
  /** Publication date, YYYY-MM-DD (newest first on /blog/). */
  date: string;
  /** Short name for cards and breadcrumbs. */
  name: Record<Lang, string>;
  copy: Record<Lang, PageCopy>;
  /** Next steps under the post: [label, path]. */
  links: Record<Lang, [string, string][]>;
};

export const blogPosts: BlogPost[] = [];

export const sortedPosts = () => [...blogPosts].sort((a, b) => b.date.localeCompare(a.date));
