/** Keep request context, deep links and page evidence out of persistent logs. */
export async function initializeLoggers(): Promise<void> {}
export async function logMainToFile(_message: string, _data?: object): Promise<void> {}
export async function logRendererToFile(_message: string, _data?: object): Promise<void> {}
