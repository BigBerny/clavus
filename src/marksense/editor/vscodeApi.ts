/**
 * Typed wrapper around the VS Code webview API.
 * `acquireVsCodeApi()` can only be called once per webview session.
 */

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

class VsCodeAPIWrapper {
  private readonly vsCodeApi: VsCodeApi | undefined;

  constructor() {
    if (typeof acquireVsCodeApi === "function") {
      this.vsCodeApi = acquireVsCodeApi();
    }
  }

  /** Post a message to the extension host */
  public postMessage(message: unknown): void {
    if (this.vsCodeApi) {
      this.vsCodeApi.postMessage(message);
    } else {
      console.log("[vscodeApi] postMessage:", message);
    }
  }

  /** Get persisted webview state */
  public getState(): unknown {
    return this.vsCodeApi?.getState();
  }

  /** Persist webview state */
  public setState(state: unknown): void {
    this.vsCodeApi?.setState(state);
  }
}

export const vscode = new VsCodeAPIWrapper();
