import { QuartzPageTypePlugin, SortFn } from '@quartz-community/types';

interface TagPageOptions {
    sort?: SortFn;
    numPages?: number;
    /** Show "Tag: " prefix before tag name in generated titles. Default: false */
    prefixTags?: boolean;
    /** Map raw tag slugs to human-facing titles (e.g. content/wiki → Wiki). */
    displayNames?: Record<string, string>;
}
declare const TagPage: QuartzPageTypePlugin<TagPageOptions>;

export { TagPage as T, type TagPageOptions as a };
