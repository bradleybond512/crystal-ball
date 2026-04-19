// The explicit `string` annotation is intentional — the build system rewrites this
// file for each variant build (full / tech / finance / happy), and widening to
// `string` keeps comparisons like `SITE_VARIANT === 'tech'` valid at type-check
// time regardless of which variant is current. Do not remove.
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const SITE_VARIANT: string = 'full';
