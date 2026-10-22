/** Dispose of a legacy transient capture without uploading its contents. */
export const deleteLocalFile = async (path: string): Promise<void> => {
  await window.api.deleteFile(path)
}
