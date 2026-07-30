import { QuartzComponent } from '@quartz-community/types';

interface FooterOptions {
    links: Record<string, string>;
    credit?: string;
}
declare const _default: (opts?: FooterOptions) => QuartzComponent;

export { _default as Footer, type FooterOptions };
