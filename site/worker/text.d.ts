// wrangler.jsonc's "rules" bundle a Markdown import as its text.
declare module '*.md' {
  const text: string;
  export default text;
}
