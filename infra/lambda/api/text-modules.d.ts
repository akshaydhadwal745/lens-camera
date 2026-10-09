// Plain-text files bundled into the Lambda by esbuild (loader '.txt': 'text').
declare module '*.txt' {
  const content: string;
  export default content;
}
