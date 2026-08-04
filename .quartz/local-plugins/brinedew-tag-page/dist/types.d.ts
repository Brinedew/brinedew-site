import { SortFn } from '@quartz-community/types';

interface TagPageOptions {
    sort?: SortFn;
    numPages?: number;
    prefixTags?: boolean;
    displayNames?: Record<string, string>;
}

export type { TagPageOptions };
