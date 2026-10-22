/** Captured request evidence must never be written to persistent diagnostics. */
export const logToFile = async (_message: string, _data?: object): Promise<void> => {};
