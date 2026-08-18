export interface ImageFileInputLike {
  files: ArrayLike<File> | null;
  value: string;
}

export function consumeSelectedImageFile(input: ImageFileInputLike): File | null {
  const file = input.files?.[0] ?? null;
  input.value = '';
  return file;
}
