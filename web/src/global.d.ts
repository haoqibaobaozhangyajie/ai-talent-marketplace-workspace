interface OpenAIHostApi {
  callTool?: (name: string, args?: unknown) => Promise<unknown>;
  toolOutput?: unknown;
}

declare global {
  interface Window {
    __LEARNING_APP_MODE__?: "widget" | "preview";
    openai?: OpenAIHostApi;
  }
}

export {};

