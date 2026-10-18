declare module "*.html?raw" {
  const html: string;
  export default html;
}

declare module "*.css?raw" { const css: string; export default css; }
declare module "*.js?raw" { const script: string; export default script; }

declare module "*.xml?raw" { const xml: string; export default xml; }
